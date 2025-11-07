import path from 'path'
import fs from 'fs'
import stream from 'stream'
import util from 'util'

import select, { Separator } from '@inquirer/select'
import checkbox from '@inquirer/checkbox'
import { getProfile } from './profile-utils.js'
export const SELECT_ALL_OPTION_VALUE = 'select-all'

import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  GetObjectCommand
} from '@aws-sdk/client-s3'
import {
  CloudFrontClient,
  GetFunctionCommand
} from '@aws-sdk/client-cloudfront'
import { fromIni } from '@aws-sdk/credential-providers'
import { loadingBar, loadingSpinner } from './loading-utils.js'

export const PROJECT_ROOT = '/Users/flyc.chung/btse/aws-tools'
const STDOUT_DIR_NAME = 'result'
const STDOUT_DIR_PATH = path.resolve(PROJECT_ROOT, STDOUT_DIR_NAME)
const FOLDER_METADATA = {
  webpages: {
    sort: 1,
    checked: true,
    description: '打包出來且可以運行的檔案，可以直接 host 看結果'
  },
  static_resource: {
    sort: 2,
    checked: false,
    description:
      '2024/11: 目前 static_resource 的機制還沒好，但有些 brand 有放測試用的檔案在這裡'
  },
  logs: {
    checked: false,
    description: 'logs 檔案，很多，不推薦勾選'
  }
}

export async function getTopLevelFolders(Bucket) {
  const client = generateAwsS3Client()
  let allPrefixes = []
  let ContinuationToken = undefined
  let IsTruncated = true

  while (IsTruncated) {
    const command = new ListObjectsV2Command({
      Bucket,
      Delimiter: '/',
      ContinuationToken
    })
    const response = await client.send(command)
    if (response.CommonPrefixes) {
      allPrefixes = allPrefixes.concat(response.CommonPrefixes)
    }
    IsTruncated = response.IsTruncated
    ContinuationToken = response.NextContinuationToken
  }
  return allPrefixes.map(p => p.Prefix.slice(0, -1)) // remove trailing '/'
}

export function generateAwsS3Client() {
  return new S3Client({
    region: 'ap-northeast-1',
    credentials: fromIni({ profile: getProfile() })
  })
}

export function interruptOperation() {
  console.log(`\x1b[1m\x1b[31m${'\n🚷 操作終止 🚷\n'}\x1b[0m`)
  return { interrupt: true }
}

export async function selectFolders({
  bucket,
  message = '選擇想要下載的資料夾'
}) {
  if (!bucket) {
    return { error: new Error('Bucket name is required to fetch folders.') }
  }
  const spinner = loadingSpinner()
  const folderOptionsResult = await getTopLevelFolders(bucket)
    .then(folders => {
      const options = folders.map(folderName => {
        const metadata = FOLDER_METADATA[folderName] || {}
        return {
          name: folderName,
          value: folderName,
          checked: metadata.checked || false,
          description: metadata.description,
          sort: metadata.sort
        }
      })

      options.sort((a, b) => {
        const aHasSort = a.sort != null
        const bHasSort = b.sort != null

        if (aHasSort && bHasSort) {
          if (a.sort !== b.sort) return a.sort - b.sort
        } else if (aHasSort) {
          return -1
        } else if (bHasSort) {
          return 1
        }

        if (a.checked !== b.checked) {
          return a.checked ? -1 : 1
        }

        return a.name.localeCompare(b.name)
      })

      return options
    })
    .catch(error => ({ error }))
  spinner.stop()

  if (folderOptionsResult.error) return folderOptionsResult

  const result = await checkbox({
    message,
    choices: folderOptionsResult
  }).catch(error => ({ error }))

  if (result.error) return result

  return { folderList: result }
}

export async function getBrandList() {
  const spinner = loadingSpinner()

  const client = generateAwsS3Client()
  const res = await client
    .send(new ListBucketsCommand({}))
    .then(result => ({ result }))
    .catch(error => ({ error }))

  spinner.stop()

  return res
}

export async function selectBrand() {
  const { error, result } = await getBrandList()
  if (error) return { error }

  const stagingBucketList = result.Buckets?.map(({ Name }) => Name) || []

  return select({
    message: '選擇一個 s3 bucket',
    pageSize: 30,
    choices: [
      {
        name: 'staging-render',
        value: { brand: 'staging-render', bucket: 'staging-render.btse.co' },
        description: 'staging-render 目前用於測試 prerender 的測試用空間'
      },

      new Separator(),

      ...stagingBucketList.map(bucket => ({
        name: bucket,
        value: { bucket }
      }))
    ]
  }).catch(error => ({ error }))
}

export function writeLog(fileName, content) {
  const jsonFilePath = path.resolve(STDOUT_DIR_PATH, fileName)
  fs.writeFileSync(
    jsonFilePath,
    typeof content === 'string' ? content : JSON.stringify(content, null, 2),
    'utf8'
  )
  console.log(`結果已寫進 ${fileName} , 完整路徑: ${jsonFilePath}`)
  return { error: null }
}

export function createResultFolder() {
  if (!fs.existsSync(STDOUT_DIR_PATH)) fs.mkdirSync(STDOUT_DIR_PATH)
}

export function generateFileName({ prefix = '', suffix = '' } = {}) {
  return `${prefix}${prefix ? '-' : ''}aws-result-${Date.now()}${
    suffix ? '-' : ''
  }${suffix}`
}

export function labelConsole(title, content) {
  console.log(`\x1b[1m\x1b[34m${title}: \x1b[0m\x1b[34m${content}\x1b[0m`)
}

export async function handleBrandOperation(
  Bucket,
  { isDownload = false, folderList, excludeFolders = [] } = {}
) {
  const client = generateAwsS3Client()
  const effectiveFolderList =
    folderList === undefined ? SELECT_ALL_OPTION_VALUE : folderList

  console.log(`\x1b[34m${'從 s3 拉取資料..'}\x1b[0m`)
  ;(function () {
    const detailMsg =
      effectiveFolderList === SELECT_ALL_OPTION_VALUE
        ? `拉取全部的資料夾, 會過濾掉 ${excludeFolders}`
        : Array.isArray(effectiveFolderList)
        ? `要拉取的資料夾: ${effectiveFolderList.join(', ')}`
        : '出錯了, 拉取全部的資料夾吧'
    console.log(detailMsg)
    if (excludeFolders.length > 0) {
      console.log(`要排除的資料夾: ${excludeFolders.join(', ')}`)
    }
  })()

  let prefixList
  if (effectiveFolderList === SELECT_ALL_OPTION_VALUE) {
    const allFolders = await getTopLevelFolders(Bucket)
    const foldersToExclude =
      excludeFolders && excludeFolders.length > 0 ? excludeFolders : ['logs']
    prefixList = allFolders.filter(folder => !foldersToExclude.includes(folder))
  } else if (Array.isArray(effectiveFolderList)) {
    prefixList = effectiveFolderList
  } else {
    prefixList = [null]
  }

  const spinner = loadingSpinner()

  let result = await Promise.all(
    prefixList.map(Prefix => _recursive([], { Prefix }))
  ).catch(error => ({ error }))
  spinner.stop()

  if (result.error) {
    console.log(`\x1b[1m\x1b[31m${'拉取失敗!'}\x1b[0m`)
    return result
  }

  result = result
    .flat()
    .filter(Boolean /* 有一些白牌還沒有 static_resource 的時候就會出現 null */)

  console.log(`\x1b[32m${'拉取資料成功'}\x1b[0m`)

  if (result.length === 0) {
    console.log(`\x1b[34m${'沒有資料'}\x1b[0m`)
    return { error: null }
  }

  const fileName = generateFileName({ prefix: Bucket })
  if (!isDownload) {
    const fileNameWithExt = `${fileName}.json`
    writeLog(fileNameWithExt, result)
    return { error: null }
  }

  console.log()
  labelConsole('目標 brand bucket', Bucket)
  labelConsole('想要下載的資料夾', folderList.join(', '))
  labelConsole('儲存的位置', path.resolve(STDOUT_DIR_NAME, fileName))

  console.log(`\x1b[34m${'\n開始下載'}\x1b[0m`)

  const list = result
  const bar = loadingBar(result.length)
  for (let i = 0; i < list.length; i++) {
    const fileInfo = list[i]
    const fileKey = fileInfo.Key

    const localFilePath = path.resolve(STDOUT_DIR_PATH, fileName, fileKey)
    if (fileKey.match(/\/$/)) continue

    // 避免 fs 要找的資料夾不存在
    fs.mkdirSync(path.dirname(localFilePath), { recursive: true })

    // 下載每個檔案
    const getCommand = new GetObjectCommand({ Bucket, Key: fileKey })
    const response = await client.send(getCommand)

    bar.increment(fileKey)
    const pipeline = util.promisify(stream.pipeline)
    await pipeline(response.Body, fs.createWriteStream(localFilePath))
  }
  bar.stop()
  console.log(`\x1b[32m${'下載完成'}\x1b[0m`)

  return { error: null }

  // 逐頁取得資料
  async function _recursive(
    result = [],
    { ContinuationToken = null, Prefix = null } = {}
  ) {
    const params = {
      Bucket,
      Prefix,
      ContinuationToken
    }
    const command = new ListObjectsV2Command(params)
    const { IsTruncated, NextContinuationToken, Contents } = await client.send(
      command
    )

    const list = result.concat(Contents)
    ;(function () {
      // console.log()
      // console.log(`'${Prefix ?? '全部'}' 新增的檔案數量: `, Contents.length)
      // console.log(`'${Prefix ?? '全部'}' 累計的檔案數量: `, list.length)
      // console.log('NextContinuationToken: ', NextContinuationToken)
    })()

    if (IsTruncated)
      return await _recursive(list, {
        ContinuationToken: NextContinuationToken,
        Prefix
      })
    return list
  }
}

// 新增 generateAwsCloudFrontClient 函式
export function generateAwsCloudFrontClient() {
  return new CloudFrontClient({
    region: 'us-east-1', // CloudFront Functions 必須部署在 us-east-1 區域
    credentials: fromIni({ profile: getProfile() })
  })
}

/**
 * 根據 FunctionARN 獲取 CloudFront Function 的詳細資訊。
 * CloudFront Functions 必須部署在 us-east-1 區域。
 *
 * @param {string} functionArn - CloudFront Function 的 ARN (例如: "arn:aws:cloudfront::ACCOUNT_ID:function/FUNCTION_NAME")
 * @returns {Promise<{result?: object, error?: Error}>} 包含 Function 詳細資訊的物件，或錯誤資訊。
 */
export async function getCloudFrontFunctionDetails(functionArn) {
  if (!functionArn) return { error: new Error('Function ARN is required.') }

  const spinner = loadingSpinner()
  try {
    const client = generateAwsCloudFrontClient()

    // 從 ARN 中提取 Function Name。ARN 格式為 arn:aws:cloudfront::ACCOUNT_ID:function/FUNCTION_NAME[:VERSION]
    const functionNameMatch = functionArn.match(/function\/(.*?)(?::\d+)?$/)
    if (!functionNameMatch || !functionNameMatch[1]) {
      throw new Error(`Invalid Function ARN format: ${functionArn}`)
    }
    const functionName = functionNameMatch[1]

    const command = new GetFunctionCommand({
      Name: functionName,
      Stage: 'LIVE' // CloudFront Functions 通常有 LIVE 或 DEVELOPMENT 階段
    })
    const response = await client.send(command)
    spinner.stop()
    let functionCodeString = ''
    if (response && response.FunctionCode) {
      functionCodeString = new TextDecoder('utf-8').decode(
        response.FunctionCode
      )
    }
    return { result: response, functionCodeString } // 返回 Function 物件和程式碼字串
  } catch (error) {
    spinner.stop()
    console.error(
      `\x1b[1m\x1b[31m${'獲取 CloudFront Function 詳情失敗!'}\x1b[0m`,
      error.message
    )
    return { error }
  }
}
