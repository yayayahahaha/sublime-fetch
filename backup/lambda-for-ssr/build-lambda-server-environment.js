import fs from 'fs'
import path from 'path'
import {
  errorExit,
  validateParams,
  indexHtmlContentFileName,
  configVariableFileName,
  successConsole
} from './build-lambda-server-environment-utils.js'

async function start() {
  const {
    errorCode,
    errorPaylooad,
    neededVariablesFilePath,
    indexHtmlPath,
    i18nFolder,
    readFilesRecursively
  } = validateParams(process.argv)
  if (errorCode != null) return errorExit(errorCode, errorPaylooad)

  // index.html part
  const indexHtmlContent = fs.readFileSync(indexHtmlPath, 'utf8')
  fs.writeFileSync(
    indexHtmlContentFileName,
    `\nexport default \`${indexHtmlContent}\`\n`
  )

  // needed config part
  const variableContent = fs.readFileSync(neededVariablesFilePath, 'utf8')
  fs.writeFileSync(configVariableFileName, variableContent)

  // i18n part
  const i18nData = readFilesRecursively(i18nFolder).map(localePath => {
    const { name: localeKey } = path.parse(localePath)
    const content = JSON.parse(fs.readFileSync(localePath, 'utf8'))
    return { localeKey, content }
  }).reduce((obj, {  localeKey, content  }) => ({ ...obj, [localeKey]: content }), {})
  const i18nSetupFileContent = fs.readFileSync('i18n-setup__for_generate.js', 'utf8')
  const replacedI18nFileContent = i18nSetupFileContent.replace(`'__i18n_message_replace_this__'`, JSON.stringify(i18nData, null, 2))
  fs.writeFileSync('i18n-setup.js', replacedI18nFileContent)

  successConsole(`創建 ${indexHtmlContentFileName} 和 ${configVariableFileName} 成功`)
}

start()