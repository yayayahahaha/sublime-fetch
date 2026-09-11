import path from 'path'
import select from '@inquirer/select'

import { consolePathHint, consoleRed, consoleStep, consoleYellow, high, requireParams } from '../utils.js'
import { resolveBrand } from '../brand-utils.js'
import { fullSyncFromFigma } from '../full-sync-utils.js'
import { STATUS } from './fetch-assets.js'
import { askFigmaUrl, runInteractiveFetch } from './pull-from-figma.js'
import { describeFetchFailure } from './report.js'

/**
 * 從 Figma 網址一路做到 frontend / s3 repo。
 *
 * 就是「從 Figma 抓圖」+「一次同步」串起來, 兩個指令本身都留著:
 *   - 抓圖那段出問題 → 用人工 export 到 figma-images, 再跑「一次同步」
 *   - 同步那段出問題 → 用「從 Figma 抓圖」把圖抓好, 再自己處理
 *
 * @param {object} options
 * @param {string} options.frontendRepoPath
 * @param {string} options.s3RepoPath
 * @param {string} options.newImagesFolder
 * @param {string} options.figmaImagesFolders
 * @param {string} options.figmaToken
 * @param {string} [options.figmaUrl] 呼叫端已經有網址的話直接傳進來, 不會再問一次。
 * @param {string} [options.targetBrand] 沒給就跳互動選單, 有給的話這裡會驗證它是否真的存在於 frontendRepoPath / s3RepoPath 底下。
 * @param {boolean} [options.clearOutputDir] 抓圖寫入 figma-images 前是否清空該資料夾, 傳了就不會跳互動選單。
 *                                          跟 skipConfirm 分開, 因為這個會真的刪檔案。
 * @param {boolean} [options.continueOnPartialFetch] 抓圖階段沒有全部成功時要不要繼續往下同步, 傳了就不會跳互動選單。
 * @param {boolean} [options.skipConfirm] 略過「即將覆蓋 repo」的確認步驟 (轉給 fullSyncFromFigma), 直接視為同意。
 * @param {number} [options.maxRetries] 撞到 Figma API 的 429 rate limit 時最多重試幾次, 轉給 fetchFigmaAssets。
 *                                     不給就用 rest.js 的預設值 (目前是 3)。
 * @param {number} [options.retryDelaySeconds] 每次重試至少等這麼多秒, 轉給 fetchFigmaAssets。
 *                                            不給就用 rest.js 的預設值 (目前是 30)。
 * @returns {Promise<{ok: boolean, reason: string|null}>} 給批量/併發呼叫端判斷成功與否用,
 *                                                        互動選單呼叫端可以直接忽略這個回傳值。
 */
export async function pullAndSyncFromFigma({
  frontendRepoPath,
  s3RepoPath,
  newImagesFolder,
  figmaImagesFolders,
  figmaToken,
  figmaUrl: presetUrl = null,
  targetBrand: presetBrand = null,
  clearOutputDir = null,
  continueOnPartialFetch = null,
  skipConfirm = false,
  maxRetries = undefined,
  retryDelaySeconds = undefined,
} = {}) {
  if (
    !requireParams(
      { frontendRepoPath, s3RepoPath, newImagesFolder, figmaImagesFolders, figmaToken },
      ['frontendRepoPath', 's3RepoPath', 'newImagesFolder', 'figmaImagesFolders', 'figmaToken']
    )
  )
    return { ok: false, reason: '缺少必要參數' }

  // 要問的全部問在前面, 後面的長工才不會跑到一半又跳出問題
  const targetBrand = await resolveBrand({ targetBrand: presetBrand, frontendRepoPath, s3RepoPath })
  if (targetBrand == null) return { ok: false, reason: 'target-brand 未解析成功' }
  consoleStep(`target-brand = ${high(targetBrand)}`)

  const url = presetUrl ?? (await askFigmaUrl())
  if (url == null) {
    consoleRed('使用者取消')
    return { ok: false, reason: '使用者取消 (沒有 Figma 網址)' }
  }

  consolePathHint({
    sourceLines: [high('Figma (REST API)')],
    targetLines: [
      `${high(path.resolve('.', figmaImagesFolders))} (抓下來的來源檔案)`,
      high(path.resolve(frontendRepoPath, 'src', `brand-${targetBrand}`)),
      high(path.resolve(s3RepoPath, targetBrand)),
    ],
  })
  console.log('這個指令會一次做完「從 Figma 抓圖」和「同步到 frontend / s3 repo」,')
  console.log('中間會有兩次確認: 一次是寫入 figma-images, 一次是覆蓋 repo。')
  console.log()

  console.log(`${high('[1/2]')} 從 Figma 抓圖`)
  console.log()
  const pulled = await runInteractiveFetch({
    figmaToken,
    outputDir: figmaImagesFolders,
    figmaUrl: url,
    clearOutputDir,
    maxRetries,
    retryDelaySeconds,
  })
  if (pulled == null) {
    consoleRed('抓圖階段沒有完成, 不會往下同步 (使用者取消)')
    return { ok: false, reason: '抓圖階段沒有完成 (使用者取消)' }
  }
  if (pulled.written.length === 0) {
    const detail = describeFetchFailure(pulled)
    consoleRed(`抓圖階段沒有完成, 不會往下同步: ${detail}`)
    return { ok: false, reason: `抓圖階段沒有完成: ${detail}` }
  }

  if (pulled.status !== STATUS.SUCCESS) {
    console.log()
    consoleYellow('⚠️  抓圖階段沒有全部成功, 表示有資產被跳過 (檔案沒抓到或沒通過檢查)。')
    consoleYellow('   往下同步的話, 缺的那些會在同步階段的來源檔案檢查被擋下來。')
    const goOn =
      continueOnPartialFetch != null
        ? continueOnPartialFetch
        : await select({
          message: '還要往下跑同步嗎?',
          choices: [
            { name: '先停在這裡, 我去確認一下', value: false },
            { name: '繼續, 讓同步階段自己擋', value: true },
          ],
        }).catch(() => false)
    if (!goOn) {
      consoleRed('停在抓圖階段, figma-images 裡的檔案留著')
      return { ok: false, reason: '抓圖階段部分失敗, 使用者選擇不繼續同步' }
    }
  }

  console.log()
  console.log(`${high('[2/2]')} 同步到 frontend / s3 repo`)
  console.log()
  return await fullSyncFromFigma({ frontendRepoPath, s3RepoPath, newImagesFolder, figmaImagesFolders, targetBrand, skipConfirm })
}
