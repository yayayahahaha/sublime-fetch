import fs from 'fs'
import path from 'path'
import { loadSettings, saveSettings } from './settings-loader.js'
import { errorConsole } from './t99-utils.js'

export function generateBrandInfo() {
  const settings = loadSettings()

  const { 'frontend-repo-path': frontendRepoPath } = settings
  if (!/^\//.test(frontendRepoPath)) {
    errorConsole('😶 請在 settings.json 裡將 frontend-repo-path 設定為絕對路徑')
    return null
  } else if (!fs.existsSync(frontendRepoPath)) {
    errorConsole(`😶 前端 repo 路徑 ${frontendRepoPath} 不存在`)
    return null
  }

  const envFilePath = path.resolve(frontendRepoPath, 'config', 'envConfig.js')
  if (!fs.existsSync(envFilePath)) {
    errorConsole(`😶 用於取得 api path 等資訊的 ${envFilePath} 檔案不存在`)
    return null
  }
  const envFileContent = fs.readFileSync(envFilePath, 'utf-8')
  const envFileContentObject = (function () {
    const objectStr = envFileContent.replace(/^module\.exports = /, '')
    try {
      return eval('(' + objectStr + ')')
    } catch (e) {
      errorConsole(`😶 無法解析 ${envFilePath} 檔案內容為 JSON 格式`, e)
      return null
    }
  })()

  if (envFileContentObject == null) return null

  const result = Object.keys(envFileContentObject).reduce((acc, key) => {
    if (/-stage$|^staging$/.test(key)) {
      const brandName = key.replace(/-stage$|^staging$/, '').toLowerCase()
      if (brandName !== '') acc[brandName] = envFileContentObject[key]
      else acc['btse'] = envFileContentObject[key]
    }

    return acc
  }, {})

  console.log(`🎉 取得品牌資訊成功, 一共有 ${Object.keys(result).length} 個品牌`)
  console.log('詳情請見 settings.json 的 brand-list 欄位')

  settings['brand-list'] = result
  saveSettings(settings)
}
