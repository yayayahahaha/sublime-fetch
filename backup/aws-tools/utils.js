import path from 'path'
import fs from 'fs'
import stream from 'stream'
import util from 'util'

import select, { Separator } from '@inquirer/select'
import checkbox from '@inquirer/checkbox'

import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  GetObjectCommand
} from '@aws-sdk/client-s3'
import { fromIni } from '@aws-sdk/credential-providers'
import { loadingBar, loadingSpinner } from './loading-utils.js'

const STDOUT_DIR_NAME = 'result'
const STDOUT_DIR_PATH = path.resolve('.', STDOUT_DIR_NAME)
const FOLDER_OPTIONS = [
  {
    value: 'webpages',
    name: 'webpages',
    checked: true,
    description: '打包出來且可以運行的檔案，可以直接 host 看結果'
  },
  {
    value: 'static_resource',
    name: 'static_resource',
    checked: false,
    description:
      '2024/11: 目前 static_resource 的機制還沒好，但有些 brand 有放測試用的檔案在這裡'
  }
]

export function generateAwsS3Client() {
  return new S3Client({
    region: 'ap-northeast-1',
    credentials: fromIni({ profile: 'staging' })
  })
}

export function interruptOperation() {
  console.log(`\x1b[1m\x1b[31m${'\n🚷 操作終止 🚷\n'}\x1b[0m`)
  return { interrupt: true }
}

export async function selectFolders({
  options = FOLDER_OPTIONS,
  message = '選擇想要下載的資料夾'
} = {}) {
  const result = await checkbox({
    message,
    choices: options
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
    message: '選擇一個白牌',
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
  {
    isDownload = false,
    folderList = FOLDER_OPTIONS.map(payload => payload.value)
  } = {}
) {
  console.log(`\x1b[34m${'從 s3 拉取資料..'}\x1b[0m`)

  const client = generateAwsS3Client()

  const spinner = loadingSpinner()
  let result = await Promise.all(
    folderList.map(Prefix => _recursive([], { Prefix }))
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

    if (IsTruncated)
      return await _recursive(list, {
        ContinuationToken: NextContinuationToken,
        Prefix
      })
    return list
  }
}
