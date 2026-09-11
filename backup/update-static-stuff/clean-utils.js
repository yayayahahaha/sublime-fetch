import path from 'path'
import fs from 'fs'
import select from '@inquirer/select'
import { consoleGreen, consoleRed, consoleStep, high } from './utils.js'

/**
 * @param {object} [options]
 * @param {string} [options.newImagesFolder] 有給才會清這個資料夾, 沒給就跳過。
 * @param {string} [options.figmaImagesFolders] 有給才會清這個資料夾, 沒給就跳過。
 * @param {boolean} [options.forceClean] 略過兩次「確定要清除 / 無法復原」的確認, 直接視為同意。
 *                                       跟其他功能的 skipConfirm 分開, 這個動作無法復原, 故意要用不同的參數名避免共用預設值。
 */
export async function cleanLocalFolders({ newImagesFolder = null, figmaImagesFolders = null, forceClean = false } = {}) {
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

  const confirm1 = forceClean
    ? true
    : await select({
      message: '確定要清除這些資料夾嗎?',
      choices: [
        { name: '等等再說', value: false },
        { name: '我確定', value: true },
      ],
    }).catch(() => false)
  if (!confirm1) return void consoleRed('使用者取消')

  const confirm2 = forceClean
    ? true
    : await select({
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
