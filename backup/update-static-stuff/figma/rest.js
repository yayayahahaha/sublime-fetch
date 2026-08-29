import { consoleRed } from '../utils.js'
import { EXPORT_AREA_NAME, PAGE_NAME_KEYWORD } from './mapping.js'

const API_BASE = 'https://api.figma.com/v1'

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

async function figmaGet(pathAndQuery, token) {
  const res = await fetch(`${API_BASE}${pathAndQuery}`, { headers: { 'X-Figma-Token': token } })

  if (!res.ok) {
    const hint = {
      401: 'token 無效, 請重新產生',
      403: 'token 缺少 file_content:read scope, 或 org 層級關閉了 API 存取',
      404: '這顆 token 的帳號看不到這個檔案 (權限或 file key 不對)',
      429: '被 rate limit, 等一下再試',
    }[res.status]
    throw new Error(`Figma API ${res.status}${hint == null ? '' : ` (${hint})`}`)
  }

  const json = await res.json()
  if (json.err != null) throw new Error(`Figma API 回了 err: ${json.err}`)
  return json
}

/** 只抓 page 層 (depth=1), 用來找出名字含 asset 的候選 page */
export async function fetchAssetPageCandidates(fileKey, token) {
  const json = await figmaGet(`/files/${fileKey}?depth=1`, token)
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
export async function fetchExportAreas(fileKey, pageIds, token) {
  const ids = pageIds.join(',')
  const json = await figmaGet(`/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}&depth=1`, token)

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
export async function fetchExportAreaTree(fileKey, nodeId, token) {
  const json = await figmaGet(`/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`, token)
  const document = json.nodes?.[nodeId]?.document
  if (document == null) throw new Error(`抓不到 export-area (${nodeId}) 的內容`)
  return document
}

/** imageRef → S3 網址, 用來量原始點陣圖的解析度 */
export async function fetchImageRefUrls(fileKey, token) {
  const json = await figmaGet(`/files/${fileKey}/images`, token)
  return json.meta?.images ?? {}
}

/**
 * 要 Figma 算圖, 回 { nodeId: url }。
 * 同一個 (format, scale) 的 node 可以一次要一批, 所以呼叫端會先分組。
 */
export async function fetchRenderUrls(fileKey, nodeIds, { format, scale }, token) {
  const params = new URLSearchParams({ ids: nodeIds.join(','), format: format.toLowerCase() })
  if (scale != null) params.set('scale', String(scale))

  const json = await figmaGet(`/images/${fileKey}?${params.toString()}`, token)
  return json.images ?? {}
}

export async function downloadBuffer(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下載失敗 ${res.status}: ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

export function consoleTokenHint() {
  consoleRed('setting.json 裡的 figma-token 沒設定或不是字串!')
  console.log('   1. 去 https://www.figma.com/developers/api#access-tokens 產生 personal access token')
  console.log('   2. scope 要勾 file_content:read')
  console.log('   3. 填進 setting.json 的 "figma-token" (setting.json 已在 .gitignore 裡)')
  console.log()
}
