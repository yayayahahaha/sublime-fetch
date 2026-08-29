import { LEVEL } from './checks.js'
import { EXPORT_AREA_NAME } from './mapping.js'
import { STATUS } from './fetch-assets.js'
import { green, high, lightYellow, yellow } from '../utils.js'

const RED = (msg) => `\x1b[31m${msg}\x1b[0m`

const LEVEL_ICON = {
  [LEVEL.ERROR]: '❌',
  [LEVEL.WARN]: '⚠️ ',
  [LEVEL.INFO]: 'ℹ️ ',
}

const LEVEL_PAINT = {
  [LEVEL.ERROR]: RED,
  [LEVEL.WARN]: yellow,
  [LEVEL.INFO]: (msg) => msg,
}

/**
 * 把 fetchFigmaAssets() 的結果物件轉成給人看的字串陣列。
 * 核心函式本身不印任何東西, 要印的都經過這裡, CLI 和互動式指令共用。
 *
 * @param {object} result
 * @param {object} [options]
 * @param {boolean} [options.color] 要不要上色, 預設 true
 * @returns {string[]}
 */
export function formatFetchResult(result, { color = true } = {}) {
  const paint = (fn, msg) => (color ? fn(msg) : msg)
  const lines = []

  if (result.file?.name != null) {
    lines.push(`📄 Figma 檔案: ${paint(high, result.file.name)}`)
  }
  if (result.page != null) {
    lines.push(`🧩 assets page: ${paint(high, result.page.name)}`)
  }
  if (result.exportArea != null) {
    const { firstLevelCount, ignoredTextNames, checkedCount } = result.exportArea
    lines.push(
      `📦 ${EXPORT_AREA_NAME}: 第一層 ${firstLevelCount} 個 node, ` +
        `丟棄 ${ignoredTextNames.length} 個 TEXT 標註, 實際檢查 ${checkedCount} 個`
    )
  }
  lines.push('')

  lines.push(...formatStatusLines(result, paint))
  lines.push(...formatFindings(result, paint))
  lines.push(...formatAssets(result, paint))
  lines.push(...formatWritten(result, paint))

  return lines
}

function formatStatusLines(result, paint) {
  switch (result.status) {
    case STATUS.INVALID_INPUT:
      return [paint(RED, `參數不對: ${result.error.message}`), '']

    case STATUS.INVALID_URL:
      return [paint(RED, `網址看不懂: ${result.error.message}`), '']

    case STATUS.API_ERROR:
      return [paint(RED, `Figma API 出錯: ${result.error.message}`), '']

    case STATUS.PAGE_NOT_FOUND:
      return [
        paint(RED, '這個檔案裡找不到名字含 "asset" 的 page。全部的 page 是:'),
        ...result.allPageNames.map((name) => `      ${name}`),
        '',
      ]

    case STATUS.EXPORT_AREA_NOT_FOUND:
      return [
        paint(RED, `找到 ${result.candidates.length} 個 assets page, 但裡面沒有名為 "${EXPORT_AREA_NAME}" 的節點:`),
        ...result.candidates.map((item) => `      ${item.pageName}`),
        ...(result.error == null ? [] : [paint(RED, `   ${result.error.message}`)]),
        '',
      ]

    case STATUS.MULTIPLE_EXPORT_AREAS:
      return [
        paint(RED, `有 ${result.candidates.length} 個 page 都含 "${EXPORT_AREA_NAME}", 無法判斷要用哪一個:`),
        ...result.candidates.map((item) => `      ${item.pageName}  (nodeId=${item.nodeId})`),
        paint(RED, '   這是 Figma 檔案結構的問題, 請找設計確認只留一個, 沒有寫入任何檔案。'),
        '',
      ]

    default:
      return []
  }
}

function formatFindings(result, paint) {
  if (result.findings.length === 0) {
    if (result.exportArea == null) return []
    return [paint(green, '檢查結果: 全部通過, 沒有任何問題'), '']
  }

  const lines = ['檢查結果:']
  for (const level of [LEVEL.ERROR, LEVEL.WARN, LEVEL.INFO]) {
    result.findings
      .filter((item) => item.level === level)
      .forEach((item) => {
        lines.push(paint(LEVEL_PAINT[level], `   ${LEVEL_ICON[level]} [${item.code}] ${item.key}: ${item.message}`))
      })
  }
  lines.push('')
  return lines
}

function formatAssets(result, paint) {
  if (result.assets.length === 0) {
    if (result.exportArea == null) return []
    return [paint(RED, '沒有任何資產通過檢查, 不會寫入任何檔案'), '']
  }

  const lines = [`可以 export 的資產 ${result.assets.length} 個:`]
  for (const asset of result.assets) {
    const size = `${Math.round(asset.width)}x${Math.round(asset.height)}`
    const outputs = asset.exports.map((item) => item.label).join(', ')
    // key / Figma 圖層名 / 輸出檔名三個可能都不一樣, 不一樣的時候要標出來,
    // 不然會以為 logo-brand 出的是 logo-brand.svg
    const notes = []
    if (asset.nodeName != null && asset.nodeName !== asset.key) notes.push(`Figma: ${asset.nodeName}`)
    if (asset.outputName !== asset.key) notes.push(`檔名: ${asset.outputName}*`)
    const suffix = notes.length === 0 ? '' : `  ← ${notes.join(', ')}`
    lines.push(`   ${asset.key.padEnd(14)} ${size.padEnd(11)} → ${asset.exports.length} 個 (${outputs})${suffix}`)
  }

  if (result.skipped.length > 0) {
    lines.push('')
    lines.push(paint(yellow, `⚠️  ${result.skipped.length} 個資產因為 error 被跳過:`))
    result.skipped.forEach((item) => lines.push(paint(yellow, `      ${item.key} (${item.codes.join(', ')})`)))
  }

  lines.push('')
  return lines
}

function formatWritten(result, paint) {
  const lines = []

  if (result.cleared.length > 0) {
    lines.push(paint(green, `🧹 寫入前清空了 ${result.outputDir} 裡的 ${result.cleared.length} 個項目`))
  }

  if (result.written.length > 0) {
    lines.push(paint(green, `共 ${result.written.length} 個檔案寫入 ${result.outputDir}`))

    const localFiles = result.written.filter((item) => item.local)
    if (localFiles.length > 0) {
      lines.push('')
      lines.push(paint(yellow, `⚠️  其中 ${localFiles.length} 個是本機 (Chromium) 算的, 不是 Figma 算的:`))
      localFiles.forEach((item) => lines.push(paint(yellow, `      ${item.fileName}`)))
      lines.push(paint(yellow, '   原因: 節點尺寸小、目標尺寸大, 換算後的 scale 超過 REST API 的上限 4,'))
      lines.push(paint(yellow, '        所以改拿 SVG 回來用 Chromium 畫成目標尺寸。'))
      lines.push(paint(yellow, '   影響: 向量來源所以不會模糊, 但 antialiasing 和 Figma 自己算的會有極細微差異,'))
      lines.push(paint(lightYellow, '        第一次用建議肉眼確認一下這幾張。'))
    }
  }

  if (result.failures.length > 0) {
    lines.push('')
    lines.push(paint(RED, `有 ${result.failures.length} 個檔案失敗:`))
    result.failures.forEach((item) => lines.push(paint(RED, `      ${item.fileName}: ${item.reason}`)))
  }

  return lines
}

/** 一行總結, 給 CLI 收尾和互動式接續用 */
export function formatSummary(result) {
  const counts = `寫入 ${result.written.length} 個檔案, 失敗 ${result.failures.length} 個, 跳過 ${result.skipped.length} 個資產`
  switch (result.status) {
    case STATUS.SUCCESS:
      return `✅ 全部完成 (${counts})`
    case STATUS.PARTIAL:
      return `⚠️  部分完成 (${counts})`
    case STATUS.DRY_RUN: {
      // dry-run 是「檢查完了」而不是「沒完成」, 不要用 ❌ 誤導
      const errors = result.findings.filter((item) => item.level === LEVEL.ERROR).length
      const wouldWrite = result.assets.reduce((sum, asset) => sum + asset.exports.length, 0)
      return errors === 0
        ? `✅ dry-run 檢查通過 (會寫入 ${wouldWrite} 個檔案, 沒有實際寫檔)`
        : `⚠️  dry-run 檢查有 ${errors} 個 error (會寫入 ${wouldWrite} 個檔案, 跳過 ${result.skipped.length} 個資產, 沒有實際寫檔)`
    }
    default:
      return `❌ 沒有完成 (status=${result.status})`
  }
}
