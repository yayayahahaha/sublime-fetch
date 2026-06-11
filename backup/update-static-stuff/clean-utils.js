import path from 'path'
import fs from 'fs'
import select from '@inquirer/select'
import { consoleGreen, consoleRed, consoleStep, high, readSetting } from './utils.js'

export async function cleanLocalFolders() {
  const settings = readSetting() ?? {}
  const newImagesFolder = settings['new-images-folder']
  const figmaImagesFolders = settings['figma-images-folders']

  const candidates = [
    path.resolve('.', 'svg-to-vue-images'),
    path.resolve('.', 'svg-to-vue-images-result'),
  ]
  if (typeof newImagesFolder === 'string') candidates.push(path.resolve('.', newImagesFolder))
  if (typeof figmaImagesFolders === 'string') candidates.push(path.resolve('.', figmaImagesFolders))

  const unique = [...new Set(candidates)]
  const existing = unique.filter((p) => fs.existsSync(p))

  if (existing.length === 0) {
    return void consoleGreen('沒有找到任何需要清除的本機資料夾')
  }

  console.log()
  console.log('將清空以下本機資料夾的內容:')
  existing.forEach((p) => console.log(`   ${high(p)}`))
  console.log()

  const confirm1 = await select({
    message: '確定要清除這些資料夾嗎?',
    choices: [
      { name: '等等再說', value: false },
      { name: '我確定', value: true },
    ],
  }).catch(() => false)
  if (!confirm1) return void consoleRed('使用者取消')

  const confirm2 = await select({
    message: '再次確認: 此動作無法復原',
    choices: [
      { name: '不要清除', value: false },
      { name: '是的，清除', value: true },
    ],
  }).catch(() => false)
  if (!confirm2) return void consoleRed('使用者取消')

  existing.forEach((p) => {
    fs.rmSync(p, { recursive: true, force: true })
    fs.mkdirSync(p, { recursive: true })
    consoleStep(`已清空 ${p}`)
  })

  consoleGreen(`共 ${existing.length} 個資料夾清除完畢!`)
}
