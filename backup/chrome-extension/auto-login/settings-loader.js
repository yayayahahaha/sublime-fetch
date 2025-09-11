import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

export function loadSettings() {
  const filename = fileURLToPath(import.meta.url)
  const dirname = path.dirname(filename)

  const settingsPath = path.resolve(dirname, '../settings.json')

  if (!fs.existsSync(settingsPath)) {
    throw new Error('請將 settings.json.default 複製為 settings.json 並設定您的設定')
  }

  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
  } catch {
    throw new Error('settings.json 的解析失敗! 看看是不是 .json 裡面用了註解或是多一個 , 在結尾')
  }
}

export function saveSettings(settingsContent) {
  let content = settingsContent
  if (typeof settingsContent !== 'string') {
    content = JSON.stringify(settingsContent, null, 2)
  }

  const filename = fileURLToPath(import.meta.url)
  const dirname = path.dirname(filename)

  const settingsPath = path.resolve(dirname, '../settings.json')

  fs.writeFileSync(settingsPath, content, 'utf8')
}
