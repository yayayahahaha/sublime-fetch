import fs from 'fs'
import path from 'path'
import readline from 'readline/promises'
import select from '@inquirer/select'

import { checkSetting, consolePathHint, consoleRed, consoleStep, consoleYellow, high, readSetting } from '../utils.js'
import { STATUS, fetchFigmaAssets } from './fetch-assets.js'
import { formatFetchResult, formatSummary } from './report.js'
import { consoleTokenHint } from './rest.js'

/** setting.json 裡的 figma-token, 沒設就印提示並回 null */
export function readFigmaToken(settings) {
  const token = settings['figma-token']
  if (typeof token !== 'string' || token.trim() === '') {
    consoleTokenHint()
    return null
  }
  return token
}

/** 只抓圖的獨立指令 */
export async function pullFromFigma() {
  const settings = readSetting()
  if (settings == null) return

  const { ok, figmaImagesFolders } = checkSetting(settings, ['figma-images-folders'])
  if (!ok) return

  const token = readFigmaToken(settings)
  if (token == null) return
  consoleStep('setting')

  consolePathHint({
    sourceLines: [high('Figma (REST API)')],
    targetLines: [high(path.resolve('.', figmaImagesFolders))],
  })
  console.log('這個指令只負責把 Figma 上的圖抓下來放進上面的資料夾,')
  console.log(`抓完之後照原本的流程跑「${high('一次同步 Figma 匯出的 static 圖片 + Logo')}」就好。`)
  console.log()

  await runInteractiveFetch({ figmaToken: token, outputDir: figmaImagesFolders })
}

/**
 * 互動式的抓圖流程: 問完問題之後呼叫 fetchFigmaAssets()。
 *
 * 先跑一次 dryRun 把報告印出來給人看, 確認之後才真的出圖 ——
 * dryRun 只打 metadata 的請求、不下載圖片, 所以多這一趟幾乎沒有成本。
 *
 * 「抓圖 + 同步」那個指令也是走這裡。
 *
 * @returns {Promise<object|null>} 真正寫入那一次的結果物件, 中途取消回 null
 */
export async function runInteractiveFetch({ figmaToken, outputDir, figmaUrl: presetUrl = null }) {
  const figmaUrl = presetUrl ?? (await askFigmaUrl())
  if (figmaUrl == null) {
    consoleRed('使用者取消')
    return null
  }

  const base = { figmaUrl, figmaToken, outputDir }

  // ---- 先看報告再決定要不要寫 ----
  const preview = await fetchFigmaAssets({ ...base, dryRun: true })
  printResult(preview)

  if (preview.status !== STATUS.DRY_RUN) {
    // 找不到 page / 多個 export-area / API 出錯 之類, 報告裡已經寫清楚了
    return null
  }

  const decision = await askWriteDecision(preview)
  if (decision == null) {
    consoleRed('使用者取消')
    return null
  }

  console.log()
  const result = await fetchFigmaAssets({
    ...base,
    clearOutputDir: decision.clear,
    // 出圖這段會跑一陣子, 印一下進行到哪
    verbose: true,
  })

  printResult(result, { skipHeader: true })
  console.log(formatSummary(result))
  return result
}

/** dryRun 那次已經印過檔案 / page / 檢查了, 真正寫入那次只要印寫檔結果 */
function printResult(result, { skipHeader = false } = {}) {
  const lines = formatFetchResult(result)
  if (!skipHeader) {
    lines.forEach((line) => console.log(line))
    return
  }
  // 從「共 N 個檔案寫入」那段開始印
  const from = lines.findIndex((line) => line.includes('寫入') || line.includes('清空') || line.includes('失敗'))
  ;(from === -1 ? lines : lines.slice(from)).forEach((line) => console.log(line))
}

export async function askFigmaUrl() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question('請貼上 Figma 檔案網址 (或直接貼 file key): ')
    return answer.trim() === '' ? null : answer
  } catch {
    return null
  } finally {
    rl.close()
  }
}

async function askWriteDecision(preview) {
  const targetDir = preview.outputDir
  const existing = fs.existsSync(targetDir) ? fs.readdirSync(targetDir).filter((name) => !name.startsWith('.')) : []

  if (existing.length > 0) {
    // 下游是用檔名遞迴索引的, 上一輪別的 brand 留下來的同名檔案會被當成這一輪的來源, 很危險
    consoleYellow(`⚠️  ${targetDir} 裡已經有 ${existing.length} 個東西:`)
    existing.slice(0, 12).forEach((name) => consoleYellow(`      ${name}`))
    if (existing.length > 12) consoleYellow(`      ... 還有 ${existing.length - 12} 個`)
    consoleYellow('   下游是用「檔名」找來源檔案的, 前一輪殘留的檔案會被誤當成這一輪的內容!')
    console.log()
  }

  const choices = []
  if (existing.length > 0) {
    choices.push({ name: '先清空資料夾再寫入 (推薦)', value: { clear: true } })
    choices.push({ name: '直接覆蓋, 殘留檔案留著', value: { clear: false } })
  } else {
    choices.push({ name: '開始寫入', value: { clear: false } })
  }
  choices.push({ name: '等等等等等等等等等等', value: null })

  const fileCount = preview.assets.reduce((sum, asset) => sum + asset.exports.length, 0)
  return await select({
    message: `即將寫入 ${preview.assets.length} 個資產共 ${fileCount} 個檔案, 要怎麼處理目標資料夾?`,
    choices,
  }).catch(() => null)
}
