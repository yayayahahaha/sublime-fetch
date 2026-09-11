import { consoleRed, consoleYellow } from '../utils.js'
import { EXPORT_AREA_NAME, PAGE_NAME_KEYWORD } from './mapping.js'

const API_BASE = 'https://api.figma.com/v1'
// 沒特別指定的話, 撞到 429 最多重試幾次
export const DEFAULT_MAX_RETRIES = 3
// 沒特別指定的話, 每次重試至少等這麼多秒 (見 figmaGet 裡 retryDelaySeconds 的說明)
export const DEFAULT_RETRY_DELAY_SECONDS = 30

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 從 Figma 網址拆出 file key。
 * 支援 /design/:key/:name 和舊的 /file/:key/:name, 也接受直接貼 key。
 */
export function parseFigmaUrl(input) {
  const trimmed = (input ?? '').trim()
  if (trimmed === '') return { ok: false, reason: '沒有輸入' }

  const matched = trimmed.match(/figma\.com\/(?:design|file)\/([A-Za-z0-9]+)/)
  if (matched != null) {
    return { ok: true, fileKey: matched[1] }
  }

  // 不是網址的話, 只有長得像 file key (純英數、夠長) 才接受直接貼 key,
  // 不然會把打錯的字串當成 key 送出去, 錯誤訊息變成看不懂的 API 404
  if (/^[A-Za-z0-9]{10,}$/.test(trimmed)) {
    return { ok: true, fileKey: trimmed }
  }

  return {
    ok: false,
    reason: '看不出 file key, 網址長得像 https://www.figma.com/design/<fileKey>/<name>, 或直接貼純英數的 file key',
  }
}

/**
 * @param {string} pathAndQuery
 * @param {string} token
 * @param {object} [options]
 * @param {number} [options.maxRetries] 撞到 429 最多重試幾次, 預設 {@link DEFAULT_MAX_RETRIES}。
 * @param {number} [options.retryDelaySeconds] 每次重試**至少**等這麼多秒, 預設 {@link DEFAULT_RETRY_DELAY_SECONDS}。
 *                                             實際等待時間是 max(Figma 回的 Retry-After, 這個值) ——
 *                                             Figma 有時候回的 Retry-After 只有 1~2 秒, 但 rate limit
 *                                             視窗通常是以分鐘計算, 等那麼短幾乎一定還是會再撞到, 所以用這個
 *                                             設一個下限, 不是照 Figma 說的秒數硬等。
 */
async function figmaGet(
  pathAndQuery,
  token,
  { maxRetries = DEFAULT_MAX_RETRIES, retryDelaySeconds = DEFAULT_RETRY_DELAY_SECONDS } = {}
) {
  let attempt = 0

  while (true) {
    const res = await fetch(`${API_BASE}${pathAndQuery}`, { headers: { 'X-Figma-Token': token } })

    if (res.status === 429 && attempt < maxRetries) {
      attempt += 1
      const retryAfter = Number(res.headers.get('retry-after'))
      const suggested = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 0
      const waitSeconds = Math.max(suggested, retryDelaySeconds)
      consoleYellow(
        `⚠️  [figma] 429 rate limit, 等待 ${waitSeconds} 秒後重試 (第 ${attempt}/${maxRetries} 次): ${pathAndQuery}`
      )
      await sleep(waitSeconds * 1000)
      continue
    }

    if (!res.ok) {
      const hint = {
        401: 'token 無效, 請重新產生',
        403: 'token 缺少 file_content:read scope, 或 org 層級關閉了 API 存取',
        404: '這顆 token 的帳號看不到這個檔案 (權限或 file key 不對)',
        429: `被 rate limit, 已重試 ${attempt} 次仍失敗, 可以調高 maxRetries / retryDelaySeconds 或降低併發數量`,
      }[res.status]
      throw new Error(`Figma API ${res.status}${hint == null ? '' : ` (${hint})`}`)
    }

    const json = await res.json()
    if (json.err != null) throw new Error(`Figma API 回了 err: ${json.err}`)
    return json
  }
}

/** 只抓 page 層 (depth=1), 用來找出名字含 asset 的候選 page */
export async function fetchAssetPageCandidates(fileKey, token, { maxRetries, retryDelaySeconds } = {}) {
  const json = await figmaGet(`/files/${fileKey}?depth=1`, token, { maxRetries, retryDelaySeconds })
  const pages = json.document?.children ?? []

  return {
    fileName: json.name,
    version: json.version,
    allPageNames: pages.map((page) => page.name),
    candidates: pages
      .filter((page) => page.name.toLowerCase().includes(PAGE_NAME_KEYWORD))
      .map((page) => ({ id: page.id, name: page.name })),
  }
}

/**
 * 一次拿多個 page 的第一層, 從裡面找 export-area。
 * 候選 page 再多也只是一個 request。
 */
export async function fetchExportAreas(fileKey, pageIds, token, { maxRetries, retryDelaySeconds } = {}) {
  const ids = pageIds.join(',')
  const json = await figmaGet(`/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}&depth=1`, token, {
    maxRetries,
    retryDelaySeconds,
  })

  const found = []
  for (const pageId of pageIds) {
    const page = json.nodes?.[pageId]?.document
    if (page == null) continue
    for (const child of page.children ?? []) {
      if (child.name.trim().toLowerCase() === EXPORT_AREA_NAME) {
        found.push({ pageId, pageName: page.name, nodeId: child.id, nodeName: child.name })
      }
    }
  }
  return found
}

/**
 * 抓 export-area 的完整 subtree (不限 depth)。
 * 實測兩個真實檔案是 70~135 KB / 93~175 個 node, 一次抓完最省事,
 * 而且 KIND / SOURCE-RES 檢查需要遞迴看子孫的 fills。
 */
export async function fetchExportAreaTree(fileKey, nodeId, token, { maxRetries, retryDelaySeconds } = {}) {
  const json = await figmaGet(`/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`, token, {
    maxRetries,
    retryDelaySeconds,
  })
  const document = json.nodes?.[nodeId]?.document
  if (document == null) throw new Error(`抓不到 export-area (${nodeId}) 的內容`)
  return document
}

/** 驗證 token 是否可用: 打最輕量的 /me, 不需要對任何檔案有權限, 拿到的是 token 對應的帳號資訊 */
export async function fetchCurrentUser(token, { maxRetries, retryDelaySeconds } = {}) {
  return figmaGet('/me', token, { maxRetries, retryDelaySeconds })
}

/** imageRef → S3 網址, 用來量原始點陣圖的解析度 */
export async function fetchImageRefUrls(fileKey, token, { maxRetries, retryDelaySeconds } = {}) {
  const json = await figmaGet(`/files/${fileKey}/images`, token, { maxRetries, retryDelaySeconds })
  return json.meta?.images ?? {}
}

/**
 * 要 Figma 算圖, 回 { nodeId: url }。
 * 同一個 (format, scale) 的 node 可以一次要一批, 所以呼叫端會先分組。
 */
export async function fetchRenderUrls(fileKey, nodeIds, { format, scale }, token, { maxRetries, retryDelaySeconds } = {}) {
  const params = new URLSearchParams({ ids: nodeIds.join(','), format: format.toLowerCase() })
  if (scale != null) params.set('scale', String(scale))

  const json = await figmaGet(`/images/${fileKey}?${params.toString()}`, token, { maxRetries, retryDelaySeconds })
  return json.images ?? {}
}

export async function downloadBuffer(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下載失敗 ${res.status}: ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

/** 「去哪裡拿 token / 放到哪個檔案」的共用提示, 不管是沒設定還是設了但檢查失敗都用這個 */
export function consoleFigmaTokenSetupHint() {
  console.log('   1. 去 https://www.figma.com/developers/api#access-tokens 產生 personal access token')
  console.log('   2. scope 要勾 file_content:read')
  console.log('   3. 填進 setting.json 的 "figma-token" (setting.json 已在 .gitignore 裡)')
  console.log()
}

export function consoleTokenHint() {
  consoleRed('setting.json 裡的 figma-token 沒設定或不是字串!')
  consoleFigmaTokenSetupHint()
}
