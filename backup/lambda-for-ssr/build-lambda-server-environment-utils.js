import fs from 'fs'
import path from 'path'

// const values
const bundleFolderParam = 'bundle-dir-name'
export const indexHtmlContentFileName = 'index-html-content.js'
export const configVariableFileName = 'config-variables.js'

// error handler
const wrongErrorCodeMessage = 'Error Code 錯誤!'
const errorMessageMap = {
  1: ({ param }) => `缺少參數 "--${param}!`,
  2: ({ param }) => `參數 "${param}" 不可為空!`,
  3: ({ bundlePath }) => `路徑 ${bundlePath} 不存在!`,
  4: ({ indexHtmlPath }) => `需要的 index.html 檔案 ${indexHtmlPath} 不存在!`,
  5: ({ variablePath }) => `需要的 config 檔案 ${variablePath} 不存在!`,
  6: ({ fileName }) => `檔案 ${fileName} 不存在! 需由 build-lambda-server-environment.js 產生!`,
  7: ({ i18nFolder }) => `需要的 i18n 資料夾 ${i18nFolder} 不存在!`
}
export function errorExit(code, payload) {
  let errorMessageFn = errorMessageMap[code]
  let errorCode = code
  if (errorMessageFn == null) {
    errorMessageFn = () => wrongErrorCodeMessage
    errorCode = -1
  }

  const errorMessage = `ErrorCode: ${errorCode}: ${errorMessageFn(payload)}`
  console.log(`\x1b[1;31m ${errorMessage} \x1b[0m`)
  process.exit(errorCode)
}
export function successConsole(msg) {
  console.log(`\x1b[1;32m ${msg} \x1b[0m`)
}

export function validateParams(argvList) {
  let errorCode = null
  let errorPaylooad = null
  let indexHtmlPath = ''
  let neededVariablesFilePath = ''
  let i18nFolder = ''

  const bundleFolderParamIndex = argvList.findIndex(
    arg => arg === `--${bundleFolderParam}`
  )
  // 是否有傳遞參數給 node 腳本
  if (bundleFolderParamIndex === -1) {
    errorCode = 1
    errorPaylooad = { param: bundleFolderParam }
    return _formatParams()
  }

  // 傳遞的參數是否為空
  const bundlePath = argvList[bundleFolderParamIndex + 1]
  if (bundlePath == null || bundlePath === '') {
    errorCode = 2
    errorPaylooad = { param: bundleFolderParam }
    return _formatParams()
  }

  // 是否可以透過傳遞的參數正確地找到打包好的 bundle 資料夾
  const resolvedBundlePath = path.resolve('./', bundlePath)
  if (!isDir(resolvedBundlePath)) {
    errorCode = 3
    errorPaylooad = { bundlePath: resolvedBundlePath }
    return _formatParams()
  }

  // 打包好的 bundle 資料夾內是否有需要的 index.html
  indexHtmlPath = path.resolve(resolvedBundlePath, 'index.html')
  if (!fs.existsSync(indexHtmlPath)) {
    errorCode = 4
    errorPaylooad = { indexHtmlPath }
    return _formatParams()
  }

  // TODO(flyc): 不一定要做: 檢查 index.html 的格式是否正確

  // 打包好的 bundle 資料夾內是否有需要的 config 變數的檔案
  neededVariablesFilePath = path.resolve(
    resolvedBundlePath,
    'export-variables',
    'lambda-server-needed-variables',
    'variables.es.js'
  )
  if (!fs.existsSync(neededVariablesFilePath)) {
    errorCode = 5
    errorPaylooad = { variablePath: neededVariablesFilePath }
    return _formatParams()
  }

  // i18n
  i18nFolder = path.resolve(
    resolvedBundlePath,
    'i18n'
  )
  if (!isDir(i18nFolder)) {
    errorCode = 7
    errorPaylooad = { i18nFolder }
    return _formatParams()
  }

  return _formatParams()

  function _formatParams() {
    return { errorCode, errorPaylooad, neededVariablesFilePath, indexHtmlPath, i18nFolder, readFilesRecursively }
  }
}

function isDir(path) {
  return fs.existsSync(path) && fs.lstatSync(path).isDirectory()
}

function readFilesRecursively(pathStr, list = []) {
  fs.readdirSync(pathStr).forEach(name => {
    const fullPath = path.join(pathStr, name)
    isDir(fullPath) ? readFilesRecursively(fullPath, list) : list.push(fullPath)
  })
  return list
}
