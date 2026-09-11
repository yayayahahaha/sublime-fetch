import path from 'path'
import select from '@inquirer/select'

import { consoleGreen, consoleRed, consoleYellow, high, requireParams } from '../utils.js'
import { pullAndSyncFromFigma } from './pull-and-sync.js'
import { DEFAULT_MAX_RETRIES, DEFAULT_RETRY_DELAY_SECONDS } from './rest.js'

/**
 * 批量/併發版的「從 Figma 網址一路同步到 frontend / s3 repo」。
 *
 * 每個 entry 各自跑一次 pullAndSyncFromFigma(), 用獨立的暫存資料夾 (tmpRoot/<brand>/...)
 * 避免併發時互相覆蓋彼此的抓圖結果。彼此失敗互不影響, 全部跑完才統一印報告。
 *
 * 批量本來就是無人值守情境, 所以內部一律用 skipConfirm: true 呼叫 pullAndSyncFromFigma,
 * 不會跳任何互動選單 (targetBrand / figmaUrl 也是必填, 不會跳 pickBrand 或問網址)。
 * 但這個函式自己開始執行前預設會擋一次確認 (見 options.skipConfirm), 因為一旦按下去就是無人值守、
 * 直接覆蓋多個 brand 的 frontend / s3 repo, 不會像單一 brand 的流程一樣中途還有機會喊停。
 *
 * @param {object} options
 * @param {{targetBrand: string, figmaUrl: string}[]} options.entries
 * @param {string} options.frontendRepoPath
 * @param {string} options.s3RepoPath
 * @param {string} options.figmaToken
 * @param {number} [options.concurrency] 同時最多幾個 brand 在跑, 預設 3 (Figma API 有 rate limit)
 * @param {boolean} [options.clearOutputDir] 各 brand 的暫存 figma-images 資料夾寫入前是否清空, 預設 true
 * @param {boolean} [options.continueOnPartialFetch] 某個 brand 抓圖沒有全部成功時要不要繼續同步該 brand, 預設 false (保守, 讓那個 brand 停在抓圖階段)
 * @param {string} [options.tmpRoot] 各 brand 暫存資料夾的根目錄, 預設 './batch-tmp'
 * @param {boolean} [options.skipConfirm] 略過開始執行前的確認, 直接視為同意。預設 false (會擋)。
 * @param {number} [options.maxRetries] 每個 brand 撞到 Figma API 的 429 rate limit 時最多重試幾次,
 *                                     轉給每個 pullAndSyncFromFigma。不給就用 rest.js 的預設值 (目前是 3)。
 *                                     批量併發打 API, 比單一 brand 更容易撞到 rate limit, 建議明確指定。
 * @param {number} [options.retryDelaySeconds] 每個 brand 每次重試至少等這麼多秒, 轉給每個 pullAndSyncFromFigma。
 *                                             不給就用 rest.js 的預設值 (目前是 30)。
 * @returns {Promise<{results: Array<{targetBrand: string, ok: boolean, reason: string|null}>, summary: {succeeded: number, failed: number}}|null>}
 */
export async function batchSyncFromFigma({
  entries,
  frontendRepoPath,
  s3RepoPath,
  figmaToken,
  concurrency = 3,
  clearOutputDir = true,
  continueOnPartialFetch = false,
  tmpRoot = './batch-tmp',
  skipConfirm = false,
  maxRetries = undefined,
  retryDelaySeconds = undefined,
} = {}) {
  if (!requireParams({ frontendRepoPath, s3RepoPath, figmaToken }, ['frontendRepoPath', 's3RepoPath', 'figmaToken']))
    return null

  const entryError = validateEntries(entries)
  if (entryError != null) {
    consoleRed(entryError)
    return null
  }

  if (!Number.isInteger(concurrency) || concurrency < 1) {
    consoleRed('concurrency 需為 >= 1 的整數')
    return null
  }

  printIntro({
    entries,
    concurrency,
    tmpRoot,
    frontendRepoPath,
    s3RepoPath,
    clearOutputDir,
    continueOnPartialFetch,
    maxRetries,
    retryDelaySeconds,
  })

  const makeSure = skipConfirm
    ? true
    : await select({
      message: '確認以上清單沒問題、frontend / s3 repo 的 git status 都已清空, 要開始批量同步嗎?',
      choices: [
        { name: '等等, 我再檢查一下', value: false },
        { name: '確定, 開始批量同步', value: true },
      ],
    }).catch(() => false)
  if (!makeSure) {
    consoleRed('使用者取消')
    return null
  }

  const results = await runWithConcurrency(entries, concurrency, (entry) =>
    runOne(entry, {
      frontendRepoPath,
      s3RepoPath,
      figmaToken,
      clearOutputDir,
      continueOnPartialFetch,
      tmpRoot,
      maxRetries,
      retryDelaySeconds,
    })
  )

  printSummary(results)
  return { results, summary: summarize(results) }
}

function printIntro({
  entries,
  concurrency,
  tmpRoot,
  frontendRepoPath,
  s3RepoPath,
  clearOutputDir,
  continueOnPartialFetch,
  maxRetries,
  retryDelaySeconds,
}) {
  console.log()
  console.log('===== 批量同步 Figma =====')
  console.log('清單檔案 (batch-sync.json) 格式, 一個陣列, 每個項目對應一個要處理的 brand:')
  console.log(`   ${high('[{ "targetBrand": "labx", "figmaUrl": "https://www.figma.com/design/..." }, ...]')}`)
  console.log()
  console.log(`每個 brand 會用獨立的暫存資料夾 (${high(`${tmpRoot}/<brand>/...`)}), 不會互相覆蓋彼此抓下來的來源檔案`)
  console.log(`同時最多 ${high(concurrency)} 個 brand 併發跑「抓圖 → 檢查 → 寫入 frontend / s3 repo」, 其他排隊等候`)
  console.log(`暫存資料夾寫入前先清空: ${high(clearOutputDir ? '是' : '否')}`)
  console.log(
    `某個 brand 抓圖沒有全部成功時: ${high(continueOnPartialFetch ? '繼續同步, 讓同步階段自己擋' : '跳過該 brand, 不往下同步')}`
  )
  console.log(
    `撞到 Figma API 429 rate limit 時: 最多重試 ${high(maxRetries ?? DEFAULT_MAX_RETRIES)} 次, ` +
      `每次至少等 ${high(retryDelaySeconds ?? DEFAULT_RETRY_DELAY_SECONDS)} 秒`
  )
  consoleYellow('⚠️  這是無人值守流程: 下面確認之後, 中間不會再跳任何選單, 會直接覆蓋每個 brand 的 frontend / s3 repo')
  console.log()
  console.log('會改動到以下兩個 repo:')
  console.log(`   frontend: ${high(path.resolve(frontendRepoPath))}`)
  console.log(`   s3:       ${high(path.resolve(s3RepoPath))}`)
  console.log()
  console.log(`即將處理 ${high(entries.length)} 個 brand:`)
  entries.forEach((entry) => {
    console.log(`   ${high(entry.targetBrand)} <- ${entry.figmaUrl}`)
    console.log(`      -> ${path.resolve(frontendRepoPath, 'src', `brand-${entry.targetBrand}`)}`)
    console.log(`      -> ${path.resolve(s3RepoPath, entry.targetBrand)}`)
  })
  console.log()
}

function validateEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return 'entries 需為非空陣列'

  const invalid = entries.find(
    (entry) =>
      typeof entry?.targetBrand !== 'string' ||
      entry.targetBrand.trim() === '' ||
      typeof entry?.figmaUrl !== 'string' ||
      entry.figmaUrl.trim() === ''
  )
  if (invalid != null) return `entries 裡有格式不對的項目 (需要 targetBrand / figmaUrl 都是非空字串): ${JSON.stringify(invalid)}`

  const brands = entries.map((entry) => entry.targetBrand)
  const duplicated = [...new Set(brands.filter((brand, index) => brands.indexOf(brand) !== index))]
  if (duplicated.length > 0) return `entries 裡有重複的 target-brand: ${duplicated.join(', ')}`

  return null
}

async function runOne(
  { targetBrand, figmaUrl },
  {
    frontendRepoPath,
    s3RepoPath,
    figmaToken,
    clearOutputDir,
    continueOnPartialFetch,
    tmpRoot,
    maxRetries,
    retryDelaySeconds,
  }
) {
  const tag = high(`[${targetBrand}]`)
  // 每個 brand 用獨立的暫存資料夾, 併發時才不會互相覆蓋彼此抓下來的來源檔案
  const newImagesFolder = path.join(tmpRoot, targetBrand, 'new-images')
  const figmaImagesFolders = path.join(tmpRoot, targetBrand, 'figma-images')

  console.log(`${tag} 開始`)
  try {
    const result = await pullAndSyncFromFigma({
      frontendRepoPath,
      s3RepoPath,
      newImagesFolder,
      figmaImagesFolders,
      figmaToken,
      figmaUrl,
      targetBrand,
      clearOutputDir,
      continueOnPartialFetch,
      maxRetries,
      retryDelaySeconds,
      skipConfirm: true,
    })

    const ok = result?.ok === true
    if (ok) consoleGreen(`${tag} 完成`)
    else consoleRed(`${tag} 失敗: ${result?.reason ?? '未知原因'}`)
    return { targetBrand, ok, reason: result?.reason ?? null }
  } catch (e) {
    consoleRed(`${tag} 拋出例外: ${e.message}`)
    return { targetBrand, ok: false, reason: e.message }
  }
}

function summarize(results) {
  const succeeded = results.filter((r) => r.ok).length
  return { succeeded, failed: results.length - succeeded }
}

function printSummary(results) {
  console.log()
  console.log('===== 批量同步結果 =====')
  results.forEach((r) => {
    console.log(`   ${r.ok ? '✅' : '❌'} ${r.targetBrand}${r.ok ? '' : ` — ${r.reason ?? ''}`}`)
  })

  const { succeeded, failed } = summarize(results)
  console.log()
  if (failed === 0) consoleGreen(`全部 ${succeeded} 個 brand 同步成功!`)
  else consoleYellow(`成功 ${succeeded} 個, 失敗 ${failed} 個`)
}

/** 簡單的併發限制 (worker pool), 不用額外依賴 */
async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)

  async function next(cursorRef) {
    const i = cursorRef.value++
    if (i >= items.length) return
    results[i] = await worker(items[i], i)
    await next(cursorRef)
  }

  const cursorRef = { value: 0 }
  const runners = Array.from({ length: Math.min(limit, items.length) }, () => next(cursorRef))
  await Promise.all(runners)
  return results
}
