import fs from 'fs'
import path from 'path'

export function loadSettings() {
  const settingsPath = path.join(process.cwd(), 'settings.json')

  if (!fs.existsSync(settingsPath)) {
    throw new Error('請將 settings.json.default 複製為 settings.json 並設定您的設定')
  }

  return JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
}