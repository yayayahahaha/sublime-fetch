import fs from 'fs'
import path from 'path'
import { imageSize } from 'image-size'

import { LEVEL, checkSourceResolution, collectVisibleImageRefs, runChecks } from './checks.js'
import {
  EXPORT_AREA_NAME,
  exportFileName,
  exportItemLabel,
  maxOutputWidth,
  outputBaseName,
  resolveRenderPlans,
} from './mapping.js'
import { encodeIco } from './ico.js'
import { closeRasterizer, rasterizeSvgToPng } from './rasterize.js'
import {
  downloadBuffer,
  fetchAssetPageCandidates,
  fetchExportAreaTree,
  fetchExportAreas,
  fetchImageRefUrls,
  fetchRenderUrls,
  parseFigmaUrl,
} from './rest.js'

/**
 * 可以獨立使用的抓圖函式。
 *
 * 這裡面**不會有任何 console 輸出**, 也不會問任何問題, 全部結果都在回傳的物件裡。
 * 要印給人看的話用 report.js 的 formatFetchResult()。
 *
 * 互動式指令和 CLI 都是薄薄一層包在這個函式外面。
 */
export const STATUS = {
  SUCCESS: 'success',
  PARTIAL: 'partial',
  DRY_RUN: 'dry-run',
  INVALID_INPUT: 'invalid-input',
  INVALID_URL: 'invalid-url',
  PAGE_NOT_FOUND: 'page-not-found',
  EXPORT_AREA_NOT_FOUND: 'export-area-not-found',
  MULTIPLE_EXPORT_AREAS: 'multiple-export-areas',
  NO_ASSETS: 'no-assets',
  API_ERROR: 'api-error',
}

/**
 * @param {object} options
 * @param {string}  options.figmaUrl         Figma 檔案網址, 也接受直接給 file key
 * @param {string}  options.figmaToken       personal access token, scope 需要 file_content:read
 * @param {string}  options.outputDir        輸出目錄, 相對路徑會用 process.cwd() 解析
 * @param {boolean} [options.clearOutputDir] 寫入前是否清空 outputDir, 預設 false
 * @param {boolean} [options.dryRun]         只做定位和檢查, 不出圖也不寫檔。
 *                                           只打 metadata 的請求, 不會下載任何圖片, 所以很便宜。
 *                                           互動式指令用這個先給人看報告再問要不要寫入
 * @param {boolean} [options.verbose]        印進行到哪的步驟 log (前綴 [figma])。
 *                                           預設 false = 完全靜默, 結果全部在回傳值裡
 * @returns {Promise<object>} 見 SPEC.md 的結果物件說明
 */
export async function fetchFigmaAssets(options = {}) {
  // figmaToken 沒在這裡解構是因為只有 run() 用得到, 從 options 直接傳下去
  const { figmaUrl, outputDir, clearOutputDir = false } = options
  const log = makeLogger(options.verbose === true)

  const result = emptyResult({ outputDir })

  const invalid = validateInput(options)
  if (invalid != null) {
    return { ...result, status: STATUS.INVALID_INPUT, error: { message: invalid } }
  }

  const parsed = parseFigmaUrl(figmaUrl)
  if (!parsed.ok) {
    return { ...result, status: STATUS.INVALID_URL, error: { message: parsed.reason } }
  }
  result.file.key = parsed.fileKey
  log(`file key = ${parsed.fileKey}`)

  try {
    return await run({
      ...options,
      clearOutputDir,
      dryRun: options.dryRun === true,
      fileKey: parsed.fileKey,
      result,
      log,
    })
  } catch (e) {
    log(`出錯: ${e.message}`)
    return { ...result, status: STATUS.API_ERROR, error: { message: e.message } }
  } finally {
    await closeRasterizer()
  }
}

// verbose 關掉的時候是真的什麼都不做, 「核心不印東西」這個保證要守住
function makeLogger(verbose) {
  if (!verbose) return () => {}
  return (message) => console.log(`[figma] ${message}`)
}

function validateInput({ figmaUrl, figmaToken, outputDir }) {
  if (typeof figmaUrl !== 'string' || figmaUrl.trim() === '') return 'figmaUrl 需為非空字串'
  if (typeof figmaToken !== 'string' || figmaToken.trim() === '') return 'figmaToken 需為非空字串'
  if (typeof outputDir !== 'string' || outputDir.trim() === '') return 'outputDir 需為非空字串'
  return null
}

function emptyResult({ outputDir }) {
  return {
    ok: false,
    status: null,
    outputDir: typeof outputDir === 'string' ? path.resolve(outputDir) : null,
    dryRun: false,
    file: { key: null, name: null, version: null },
    page: null,
    exportArea: null,
    // 沒找到 page 時給全部 page 名字, 方便判斷是不是被改名了
    allPageNames: [],
    // 多個 export-area 時的候選清單
    candidates: [],
    findings: [],
    assets: [],
    skipped: [],
    written: [],
    failures: [],
    cleared: [],
    error: null,
  }
}

async function run({ figmaToken, outputDir, clearOutputDir, dryRun, fileKey, result, log }) {
  const token = figmaToken
  result.dryRun = dryRun

  // ---- 1. 找 page (名字含 asset) ----
  const pageInfo = await fetchAssetPageCandidates(fileKey, token)
  result.file.name = pageInfo.fileName
  result.file.version = pageInfo.version
  result.allPageNames = pageInfo.allPageNames
  log(
    `檔案 "${pageInfo.fileName}" 共 ${pageInfo.allPageNames.length} 個 page, ` +
      `名字含 "asset" 的有 ${pageInfo.candidates.length} 個`
  )

  if (pageInfo.candidates.length === 0) {
    return { ...result, status: STATUS.PAGE_NOT_FOUND }
  }

  // ---- 2. 在候選 page 的第一層找 export-area ----
  const areas = await fetchExportAreas(
    fileKey,
    pageInfo.candidates.map((page) => page.id),
    token
  )
  result.candidates = areas.map((area) => ({
    pageId: area.pageId,
    pageName: area.pageName,
    nodeId: area.nodeId,
  }))

  if (areas.length === 0) {
    return {
      ...result,
      status: STATUS.EXPORT_AREA_NOT_FOUND,
      candidates: pageInfo.candidates.map((page) => ({ pageId: page.id, pageName: page.name, nodeId: null })),
    }
  }

  // 多個就是 Figma 檔案結構有問題, 不猜也不讓人選, 直接當錯誤讓人去問設計
  if (areas.length > 1) {
    log(`找到 ${areas.length} 個 export-area, 無法判斷要用哪一個`)
    return { ...result, status: STATUS.MULTIPLE_EXPORT_AREAS }
  }

  const area = areas[0]
  result.page = { id: area.pageId, name: area.pageName }
  log(`export-area 在 "${area.pageName}" (${area.nodeId})`)

  // ---- 3. 抓完整 subtree 並檢查 ----
  const tree = await fetchExportAreaTree(fileKey, area.nodeId, token)
  const firstLevel = tree.children ?? []
  const { assets, findings, ignoredTextNames } = runChecks(tree)

  result.exportArea = {
    name: EXPORT_AREA_NAME,
    nodeId: area.nodeId,
    firstLevelCount: firstLevel.length,
    ignoredTextNames,
    checkedCount: firstLevel.length - ignoredTextNames.length,
  }
  log(
    `export-area 第一層 ${firstLevel.length} 個 node, ` +
      `丟棄 ${ignoredTextNames.length} 個 TEXT 標註, 實際檢查 ${firstLevel.length - ignoredTextNames.length} 個`
  )

  const resolutionFindings = await checkSourceResolutions(fileKey, assets, token, log)
  result.findings = [...findings, ...resolutionFindings]

  result.assets = assets.map((asset) => describeAsset(asset))
  result.skipped = collectSkipped(result.findings, assets)

  const errorCount = result.findings.filter((item) => item.level === LEVEL.ERROR).length
  log(`檢查完畢: ${assets.length} 個資產可出圖, ${result.skipped.length} 個被跳過, ${errorCount} 個 error`)

  if (assets.length === 0) {
    return { ...result, status: STATUS.NO_ASSETS }
  }

  if (dryRun) {
    log('dryRun, 不出圖也不寫檔')
    return {
      ...result,
      ok: !result.findings.some((item) => item.level === LEVEL.ERROR),
      status: STATUS.DRY_RUN,
    }
  }

  // ---- 4. 清空 / 寫入 ----
  const resolvedOutputDir = path.resolve(outputDir)
  if (clearOutputDir) {
    result.cleared = clearDir(resolvedOutputDir)
    log(`清空 ${resolvedOutputDir} 裡的 ${result.cleared.length} 個項目`)
  }
  fs.mkdirSync(resolvedOutputDir, { recursive: true })

  const { written, failures } = await renderAndWrite({ fileKey, assets, token, outputDir: resolvedOutputDir, log })
  result.written = written
  result.failures = failures

  const hasError = result.findings.some((item) => item.level === LEVEL.ERROR) || failures.length > 0
  return {
    ...result,
    ok: written.length > 0 && !hasError,
    status: written.length === 0 ? STATUS.NO_ASSETS : hasError ? STATUS.PARTIAL : STATUS.SUCCESS,
  }
}

function describeAsset(asset) {
  return {
    // 三個名字可能都不一樣:
    //   key        = mapping 表裡的正規名字 (e.g. logo-brand)
    //   nodeName   = Figma 上實際的圖層名字, 可能是 alias 或大小寫不同 (e.g. logo-dark / PWA_icon)
    //   outputName = 輸出檔名的前綴 (e.g. logo-dark / PWA_icon)
    key: asset.spec.key,
    nodeName: asset.node.name,
    outputName: outputBaseName(asset.spec),
    nodeId: asset.node.id,
    nodeType: asset.node.type,
    width: asset.size.width,
    height: asset.size.height,
    exports: asset.spec.exports.map((exportItem) => {
      const plans = resolveRenderPlans(exportItem, asset.size)
      return {
        fileName: exportFileName(asset.spec, exportItem),
        format: exportItem.format,
        label: exportItemLabel(exportItem),
        local: plans.some((plan) => plan.local),
      }
    }),
  }
}

/** mapping 表裡有、但因為 error 沒進 assets 的那些 */
function collectSkipped(findings, assets) {
  const usable = new Set(assets.map((asset) => asset.spec.key))
  const skipped = new Map()
  for (const item of findings) {
    if (item.level !== LEVEL.ERROR) continue
    if (usable.has(item.key)) continue
    if (!skipped.has(item.key)) skipped.set(item.key, [])
    skipped.get(item.key).push(item.code)
  }
  return [...skipped].map(([key, codes]) => ({ key, codes }))
}

function clearDir(dir) {
  if (!fs.existsSync(dir)) return []
  const names = fs.readdirSync(dir).filter((name) => !name.startsWith('.'))
  names.forEach((name) => fs.rmSync(path.resolve(dir, name), { recursive: true, force: true }))
  return names
}

/** 下載原始點陣圖來量解析度, 純提醒性質, 失敗就跳過 */
async function checkSourceResolutions(fileKey, assets, token, log) {
  const needing = assets
    .map((asset) => ({ asset, refs: [...collectVisibleImageRefs(asset.node)] }))
    .filter((item) => item.refs.length > 0)

  if (needing.length === 0) return []

  const refCount = needing.reduce((sum, item) => sum + item.refs.length, 0)
  log(`量 ${refCount} 張原始點陣圖的解析度 (${needing.length} 個資產底下有 image fill)`)

  let refUrls
  try {
    refUrls = await fetchImageRefUrls(fileKey, token)
  } catch {
    // 量不到就算了, 這條本來就只是提醒
    log('拿不到原始點陣圖清單, 跳過解析度檢查')
    return []
  }

  const findings = []
  for (const { asset, refs } of needing) {
    const maxWidth = maxOutputWidth(asset.spec, asset.size)

    const measured = []
    for (const ref of refs) {
      const url = refUrls[ref]
      if (url == null) continue
      try {
        const buffer = await downloadBuffer(url)
        const { width, height } = imageSize(buffer)
        measured.push({ width, height })
      } catch {
        // 同上
      }
    }
    findings.push(...checkSourceResolution(asset.spec.key, maxWidth, measured))
  }
  return findings
}

/**
 * 先把所有輸出攤成 render job, 依 (format, scale) 分組向 Figma 要圖,
 * 這樣同倍率的多個節點可以一次要完, 不用一個檔案一個 request。
 */
async function renderAndWrite({ fileKey, assets, token, outputDir, log }) {
  const jobs = []
  for (const asset of assets) {
    for (const exportItem of asset.spec.exports) {
      jobs.push({
        asset,
        exportItem,
        // ICO 會有多個 (每個內嵌尺寸一張), 其它都是一張
        plans: resolveRenderPlans(exportItem, asset.size),
        fileName: exportFileName(asset.spec, exportItem),
      })
    }
  }

  const groups = new Map()
  for (const job of jobs) {
    for (const plan of job.plans) {
      const groupKey = renderKey(plan)
      if (!groups.has(groupKey)) {
        groups.set(groupKey, { format: plan.renderFormat, scale: plan.scale, nodeIds: new Set() })
      }
      groups.get(groupKey).nodeIds.add(job.asset.node.id)
    }
  }

  log(`要向 Figma 要 ${groups.size} 組圖 (依 format + scale 分組), 產出 ${jobs.length} 個檔案`)

  const rendered = new Map()
  for (const [groupKey, group] of groups) {
    const nodeIds = [...group.nodeIds]
    const urls = await fetchRenderUrls(fileKey, nodeIds, { format: group.format, scale: group.scale }, token)
    for (const nodeId of nodeIds) {
      const url = urls[nodeId]
      if (url == null) continue
      rendered.set(`${groupKey}::${nodeId}`, await downloadBuffer(url))
    }
    log(`  已取得 ${group.format}${group.scale == null ? '' : ` @${group.scale}x`} × ${nodeIds.length} 個節點`)
  }

  const written = []
  const failures = []

  for (const job of jobs) {
    const sources = job.plans.map((plan) => rendered.get(`${renderKey(plan)}::${job.asset.node.id}`))
    if (sources.some((source) => source == null)) {
      failures.push({ fileName: job.fileName, assetKey: job.asset.spec.key, reason: 'Figma 沒有回這個節點的圖' })
      continue
    }

    try {
      const buffer = await buildOutput(job, sources, log)
      const filePath = path.resolve(outputDir, job.fileName)
      fs.writeFileSync(filePath, buffer)
      log(`  寫入 ${job.fileName} (${buffer.length}B)`)
      written.push({
        fileName: job.fileName,
        assetKey: job.asset.spec.key,
        filePath,
        bytes: buffer.length,
        format: job.exportItem.format,
        // true 表示這張是本機 Chromium 畫的, 不是 Figma 算的
        local: job.plans.some((plan) => plan.local),
      })
    } catch (e) {
      failures.push({ fileName: job.fileName, assetKey: job.asset.spec.key, reason: e.message })
    }
  }

  return { written, failures }
}

function renderKey(plan) {
  return `${plan.renderFormat}@${plan.scale ?? 1}`
}

async function buildOutput(job, sources, log) {
  const { exportItem, plans } = job

  if (exportItem.format === 'SVG') {
    return sources[0]
  }

  // scale 超過 REST 上限的就是拿 SVG 回來自己畫成目標尺寸
  const pngs = []
  for (let i = 0; i < plans.length; i += 1) {
    const plan = plans[i]
    if (plan.local) {
      log(`  本機 rasterize ${job.fileName} → ${plan.targetWidth}x${plan.targetHeight}`)
    }
    const png = plan.local
      ? await rasterizeSvgToPng(sources[i].toString('utf8'), { width: plan.targetWidth, height: plan.targetHeight })
      : sources[i]
    verifyRasterSize(plan, png)
    pngs.push(png)
  }

  if (exportItem.format === 'PNG') return pngs[0]

  if (exportItem.format === 'ICO') {
    return encodeIco(
      pngs.map((png) => {
        const { width, height } = imageSize(png)
        return { width, height, buffer: png }
      })
    )
  }

  throw new Error(`不支援的 format: ${exportItem.format}`)
}

/** 出圖之後實際量一次, 尺寸不對就當這個檔案失敗 (不影響其它檔案) */
function verifyRasterSize(plan, buffer) {
  if (plan.targetWidth == null) return

  const { width, height } = imageSize(buffer)
  if (Math.abs(width - plan.targetWidth) > 1 || Math.abs(height - plan.targetHeight) > 1) {
    throw new Error(`尺寸不對, 預期 ${plan.targetWidth}x${plan.targetHeight}, 實際 ${width}x${height}`)
  }
}
