import select, { Separator } from '@inquirer/select'
import checkbox from '@inquirer/checkbox'
import fs from 'fs'
import path from 'path'
import {
  createResultFolder,
  generateFileName,
  getBrandList,
  handleBrandOperation,
  interruptOperation,
  SELECT_ALL_OPTION_VALUE,
  selectBrand,
  selectFolders,
  writeLog,
  getCloudFrontFunctionDetails
} from './utils.js'
import { listCloudFrontDistributions } from './cloudfront-utils.js'
import { getProfile, getProfileOptions, setProfile } from './profile-utils.js'

start()
async function start() {
  const profileAnswer = await select({
    message: '要用哪個 aws profile ?',
    choices: getProfileOptions()
  }).catch(() => null)
  if (profileAnswer == null) return void interruptOperation()
  setProfile(profileAnswer)

  console.log(
    `現在使用的 profile 是 ${`\x1b[1m\x1b[31m${getProfile()}\x1b[0m`}`
  )

  createResultFolder()

  const behaviorAnswer = await select({
    message: '你想做什麼?',
    choices: [
      {
        name: '👀 查看 s3 的檔案',
        value: 'view',
        description:
          '會列出所有有查閱權限的 s3 buckets, 再從中擇一、查看該 s3 bucket 的內容'
      },
      {
        name: '📁 下載 s3 的檔案',
        value: 'downlaod',
        description:
          '會列出所有有查閱權限的 s3 buckets, 再從中擇一、下載該 s3 bucket 的內容'
      },
      { name: '🩻 列出所有的 s3 buckets', value: 'list-bucket' },
      new Separator(),
      {
        name: '🌈 列出所有的 cloudfront 設定',
        value: 'list-cloudfront',
        description:
          '如果有要查看 CloudFront 的 FunctionAssociations 的話也是從這裡看'
      },
      new Separator()
    ]
  }).catch(() => null)
  if (behaviorAnswer == null) return void interruptOperation()

  let result = {}
  switch (behaviorAnswer) {
    case 'view':
      result = await _view()
      break

    case 'downlaod':
      result = await _downlaod()
      break

    case 'list-bucket':
      result = await _listBucket()
      break

    case 'list-cloudfront':
      result = await _listCloudfront()
      break
  }

  const { error, interrupt } = result || {}
  if (interrupt) return // 被使用者中斷了

  if (error != null) {
    console.error(error)
    console.log(`\x1b[1m\x1b[31m${'🦐 操作失敗 🦐'}\x1b[0m`)
    return
  }
  console.log(`\x1b[1m\x1b[32m${'\n🐋 操作成功 🐋\n'}\x1b[0m`)

  return

  async function _view() {
    const { error, bucket } = await selectBrand()
    if (error) return interruptOperation()

    const allOrSelect = await select({
      message: '請選擇想要查閱的範圍: ',
      choices: [
        { name: '全部', value: SELECT_ALL_OPTION_VALUE },
        { name: '手動選擇', value: 'select-manually' }
      ]
    }).catch(() => null)
    if (allOrSelect == null) return interruptOperation()

    const folderList =
      allOrSelect === SELECT_ALL_OPTION_VALUE
        ? SELECT_ALL_OPTION_VALUE
        : await selectFolders({ bucket }).then(({ folderList }) => folderList)
    if (folderList == null) return interruptOperation()

    return await handleBrandOperation(bucket, { folderList })
  }

  async function _downlaod() {
    const { error: brandError, bucket } = await selectBrand()
    if (brandError) return interruptOperation()

    const { error: folderError, folderList } = await selectFolders({ bucket })
    if (folderError) return interruptOperation()

    if (folderList.length === 0) {
      return void console.log(`\x1b[34m${'沒有選擇資料夾'}\x1b[0m`)
    }

    return await handleBrandOperation(bucket, {
      folderList,
      isDownload: true
    })
  }

  async function _listBucket() {
    const { error, result } = await getBrandList()
    if (error) return { error }

    writeLog(`${generateFileName()}.json`, result)

    return { error: null }
  }

  async function _listCloudfront() {
    const { error, result, webCloudfront } = await listCloudFrontDistributions()
    if (error) return { error }

    writeLog(`${generateFileName({ prefix: 'cloudfront_list' })}.json`, result)
    writeLog(
      `${generateFileName({ prefix: 'web_cloudfront' })}.json`,
      webCloudfront
    )

    console.log()

    // --- 新增功能開始 ---

    // 1. 掃描所有 CloudFront distributions，找出包含 FunctionAssociations 的
    const cfsWithFunctions = result.filter(cf => {
      const defaultHasFunc =
        cf.DefaultCacheBehavior?.FunctionAssociations?.Quantity > 0
      const behaviorHasFunc = cf.CacheBehaviors?.Items?.some(
        b => b.FunctionAssociations?.Quantity > 0
      )
      return defaultHasFunc || behaviorHasFunc
    })

    if (cfsWithFunctions.length === 0) {
      console.log(
        '\n未找到任何包含 Function Associations 的 CloudFront distribution。'
      )
      return { error: null }
    }

    // 2. 詢問使用者是否要查看 Function 細節
    const shouldInspect = await select({
      message:
        '發現有 CloudFront distribution 包含 Function(s)，是否要進一步查看細節？',
      choices: [
        { name: '是', value: true },
        { name: '否', value: false }
      ]
    }).catch(() => null)

    if (shouldInspect === null || !shouldInspect) return interruptOperation()

    // 3. 讓使用者多選要查看的 CloudFront distributions
    const selectedCfIds = await checkbox({
      message: '請選擇要查看的 CloudFront distribution(s):',
      choices: [
        ...cfsWithFunctions
          .map(cf => {
            const name = cf.Aliases.Items?.[0] || cf.DomainName || cf.Id

            return {
              name,
              value: cf.Id,
              description: `ID: ${cf.Id}, DomainName: ${cf.DomainName}`
            }
          })
          .sort((a, b) => a.name.localeCompare(b.name)),
        new Separator()
      ],
      shortcuts: { all: null, invert: null }
    }).catch(() => null)

    if (selectedCfIds === null) return interruptOperation()
    if (selectedCfIds.length === 0) {
      console.log('\n未選擇任何項目。')
      return { error: null }
    }

    // 4. 逐一讓使用者選擇要查看的 FunctionAssociations
    const finalSelections = {}
    for (const cfId of selectedCfIds) {
      const cf = cfsWithFunctions.find(c => c.Id === cfId)
      const cfName = cf.Aliases.Items[0] || cf.Id

      const allFunctions = []
      if (cf.DefaultCacheBehavior?.FunctionAssociations?.Quantity > 0) {
        allFunctions.push(...cf.DefaultCacheBehavior.FunctionAssociations.Items)
      }
      if (cf.CacheBehaviors?.Quantity > 0) {
        cf.CacheBehaviors.Items.forEach(b => {
          if (b.FunctionAssociations?.Quantity > 0) {
            allFunctions.push(...b.FunctionAssociations.Items)
          }
        })
      }
      const uniqueFunctions = [
        ...new Map(allFunctions.map(item => [item.FunctionARN, item])).values()
      ]

      const selectedFunctionsForCf = await checkbox({
        message: `請選擇要為 ${cfName} 查看的 Function(s):`,
        choices: uniqueFunctions.map(func => ({
          name: func.FunctionARN.split('/').pop(),
          value: func.FunctionARN
        }))
      }).catch(() => null)

      if (selectedFunctionsForCf === null) return interruptOperation()
      if (selectedFunctionsForCf.length > 0) {
        finalSelections[cfId] = selectedFunctionsForCf
      }
    }

    // 5. 獲取內容並存檔
    console.log('\n正在獲取 Function 詳細資訊並存檔...')
    for (const cfId in finalSelections) {
      const cf = cfsWithFunctions.find(c => c.Id === cfId)
      const cfName = (cf.Aliases.Items[0] || cf.Id).replace(/\*/g, '_wildcard_')

      for (const funcArn of finalSelections[cfId]) {
        const { result: funcDetails, functionCodeString } =
          await getCloudFrontFunctionDetails(funcArn)
        if (funcDetails) {
          const funcName = funcArn.split('/').pop()
          const timestampedFolderName = generateFileName({
            prefix: cfName,
            suffix: 'functions'
          })
          const folderPath = path.resolve('result', timestampedFolderName)
          fs.mkdirSync(folderPath, { recursive: true })

          // 存檔路徑相對於 result 資料夾
          const objectFilePath = path.join(
            timestampedFolderName,
            `${funcName}.json`
          )
          const codeFilePath = path.join(
            timestampedFolderName,
            `${funcName}.js`
          )

          writeLog(objectFilePath, funcDetails)
          writeLog(codeFilePath, functionCodeString)
        }
      }
    }

    return { error: null }
  }
}

// reference
// https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/getting-started-nodejs.html
// https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/s3-node-examples.html
// https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/migrating/notable-changes/
// https://stackoverflow.com/questions/2685435/cooler-ascii-spinners

// javascript SDK V2 在 2025/9 會過期, 目前用的都是 V3
// https://aws.amazon.com/blogs/developer/announcing-end-of-support-for-aws-sdk-for-javascript-v2/
