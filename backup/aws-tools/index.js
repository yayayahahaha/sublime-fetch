// TODO(flyc): 切換 credential
import select, { Separator } from '@inquirer/select'
import {
  createResultFolder,
  generateFileName,
  getBrandList,
  handleBrandOperation,
  interruptOperation,
  selectBrand,
  selectFolders,
  writeLog
} from './utils.js'
import { listCloudFrontDistributions } from './cloudfront-utils.js'

start()
async function start() {
  createResultFolder()

  const behaviorAnswer = await select({
    message: '你想做什麼?',
    choices: [
      { name: '👀 查看 staging 環境上的檔案', value: 'view' },
      { name: '📁 下載 staging 環境上的檔案', value: 'downlaod' },
      { name: '🩻 列出 staging 所有的 s3 buckets', value: 'list-bucket' },
      new Separator(),
      { name: '🌈 列出 staging 所有的 cloudfront', value: 'list-cloudfront' },
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

    return await handleBrandOperation(bucket)
  }

  async function _downlaod() {
    const { error: folderError, folderList } = await selectFolders()
    if (folderError) return interruptOperation()

    if (folderList.length === 0) {
      return void console.log(`\x1b[34m${'沒有選擇資料夾'}\x1b[0m`)
    }

    const { error: brandError, bucket } = await selectBrand()
    if (brandError) return interruptOperation()

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
