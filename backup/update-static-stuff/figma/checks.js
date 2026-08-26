import {
  ASSET_NODE_TYPES,
  EXPORT_MAP,
  IGNORED_NODE_TYPES,
  LOGO_PAIR,
  matchesSpec,
  specAliases,
} from './mapping.js'

// 尺寸都是 float, 差不到半個 px 就當一樣
const SIZE_TOLERANCE = 0.5

export const LEVEL = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
}

function finding(level, code, key, message) {
  return { level, code, key, message }
}

function nodeSize(node) {
  const box = node.absoluteBoundingBox ?? {}
  return { width: box.width ?? 0, height: box.height ?? 0 }
}

function isVisible(node) {
  return node.visible !== false
}

/** 遞迴收集可見的 IMAGE fill (隱藏的節點不會被 export, 所以要跳過) */
export function collectVisibleImageRefs(node, refs = new Set()) {
  if (!isVisible(node)) return refs

  for (const fill of node.fills ?? []) {
    if (fill.type === 'IMAGE' && fill.visible !== false && fill.imageRef != null) {
      refs.add(fill.imageRef)
    }
  }
  for (const child of node.children ?? []) {
    collectVisibleImageRefs(child, refs)
  }
  return refs
}

/** 節點自己有沒有不透明的底色 (PWA / Favicon 那套應該要有) */
function hasOpaqueBackground(node) {
  if (node.opacity != null && node.opacity < 1) return false
  return (node.fills ?? []).some(
    (fill) => fill.type === 'SOLID' && fill.visible !== false && (fill.opacity == null || fill.opacity >= 1)
  )
}

/**
 * 檢查 export-area 第一層。
 *
 * @returns {{ assets: Array, findings: Array, ignoredTextNames: Array<string> }}
 *          assets 只包含「可以往下走 export」的項目, 有 error 的不會進去
 */
export function runChecks(exportAreaNode) {
  const findings = []
  const firstLevel = exportAreaNode.children ?? []

  const ignoredTextNames = firstLevel.filter((node) => IGNORED_NODE_TYPES.includes(node.type)).map((node) => node.name)
  const candidates = firstLevel.filter((node) => !IGNORED_NODE_TYPES.includes(node.type))

  // ---- DUP: 同名的一律擋掉, 重複就無法決定要哪個 ----
  const byName = new Map()
  for (const node of candidates) {
    if (!byName.has(node.name)) byName.set(node.name, [])
    byName.get(node.name).push(node)
  }

  const usableByName = new Map()
  for (const [name, nodes] of byName) {
    if (nodes.length > 1) {
      const sizes = nodes.map((node) => {
        const { width, height } = nodeSize(node)
        return `${round(width)}x${round(height)}`
      })
      findings.push(
        finding(LEVEL.ERROR, 'DUP', name, `export-area 第一層有 ${nodes.length} 個同名節點 (${sizes.join(', ')})`)
      )
      continue
    }
    usableByName.set(name, nodes[0])
  }

  // ---- 逐一檢查 mapping 表裡的資產 ----
  // 名字比對是「正規化後比對 key + aliases」, 所以 PWA_icon / pwa-icon 是同一個,
  // logo-brand / logo-dark 也是同一個。命中多個不同名字就無法決定要哪個, 直接當 error。
  const allNames = [...byName.keys()]
  const claimed = new Set()
  const nodeBySpecKey = new Map()
  const assets = []

  for (const spec of EXPORT_MAP) {
    const matchedNames = allNames.filter((name) => matchesSpec(spec, name))
    matchedNames.forEach((name) => claimed.add(name))

    if (matchedNames.length === 0) {
      findings.push(
        finding(
          LEVEL.ERROR,
          'MISSING',
          spec.key,
          `mapping 表裡有, 但 Figma 的 export-area 裡找不到 (可接受的名字: ${specAliases(spec).join(' / ')})`
        )
      )
      continue
    }

    if (matchedNames.length > 1) {
      findings.push(
        finding(
          LEVEL.ERROR,
          'MULTI-MATCH',
          spec.key,
          `同時命中 ${matchedNames.length} 個圖層 (${matchedNames.join(', ')}), 無法決定要用哪個, 請只留一個`
        )
      )
      continue
    }

    const node = usableByName.get(matchedNames[0])
    // 命中的那個名字被 DUP 擋掉了, DUP 已經報過就不要再講一次
    if (node == null) continue

    const assetFindings = checkOneAsset(spec, node)
    findings.push(...assetFindings)

    if (assetFindings.some((item) => item.level === LEVEL.ERROR)) continue
    nodeBySpecKey.set(spec.key, node)
    assets.push({ spec, node, size: nodeSize(node) })
  }

  // ---- UNKNOWN: 沒被任何 spec 認領的, 只提醒不擋 ----
  for (const name of allNames) {
    if (claimed.has(name)) continue
    findings.push(finding(LEVEL.WARN, 'UNKNOWN', name, '不在 mapping 表裡, 不會被 export'))
  }

  findings.push(...checkLogoPair(nodeBySpecKey))

  return { assets, findings, ignoredTextNames }
}

function checkOneAsset(spec, node) {
  const findings = []
  const { key } = spec
  const { width, height } = nodeSize(node)

  // ---- TYPE ----
  if (!ASSET_NODE_TYPES.includes(node.type)) {
    findings.push(
      finding(
        LEVEL.ERROR,
        'TYPE',
        key,
        `type 是 ${node.type}, 需為 ${ASSET_NODE_TYPES.join(' / ')} (可能是放錯位置或結構被改過)`
      )
    )
  }

  // ---- SIZE ----
  if (spec.expect != null) {
    const widthOk = Math.abs(width - spec.expect.width) < SIZE_TOLERANCE
    const heightOk = Math.abs(height - spec.expect.height) < SIZE_TOLERANCE
    if (!widthOk || !heightOk) {
      findings.push(
        finding(
          LEVEL.ERROR,
          'SIZE',
          key,
          `節點尺寸應為 ${spec.expect.width}x${spec.expect.height}, 實際是 ${round(width)}x${round(height)}`
        )
      )
    }
  }

  // ---- KIND: 要出 SVG 就不能含點陣圖, 不然 SVG 會內嵌一坨 base64 ----
  const imageRefs = collectVisibleImageRefs(node)
  const wantsSvg = spec.exports.some((item) => item.format === 'SVG')
  if (wantsSvg && imageRefs.size > 0) {
    findings.push(
      finding(LEVEL.ERROR, 'KIND', key, `要 export SVG, 但底下有 ${imageRefs.size} 個點陣圖 fill, SVG 會內嵌 base64`)
    )
  }

  // ---- FRACTIONAL ----
  if (!isInteger(width) || !isInteger(height)) {
    findings.push(finding(LEVEL.WARN, 'FRACTIONAL', key, `尺寸不是整數 (${width}x${height}), 出圖會被四捨五入`))
  }

  // ---- OVERFLOW: 陰影 / 描邊超出邊界, export 出來會比宣告尺寸大 ----
  const render = node.absoluteRenderBounds
  if (render != null && (render.width > width + SIZE_TOLERANCE || render.height > height + SIZE_TOLERANCE)) {
    findings.push(
      finding(
        LEVEL.WARN,
        'OVERFLOW',
        key,
        `實際繪製範圍 ${round(render.width)}x${round(render.height)} 超出邊界 ${round(width)}x${round(height)} (陰影或描邊?)`
      )
    )
  }

  // ---- ALPHA ----
  if (spec.opaque && !hasOpaqueBackground(node)) {
    findings.push(finding(LEVEL.WARN, 'ALPHA', key, '應該要有不透明底色, 但節點自己沒有可見的實心 fill'))
  }

  // ---- STATE ----
  if (!isVisible(node)) {
    findings.push(finding(LEVEL.INFO, 'STATE', key, '節點目前是隱藏的'))
  }
  if (node.opacity != null && node.opacity < 1) {
    findings.push(finding(LEVEL.INFO, 'STATE', key, `opacity 是 ${node.opacity}, 不是 1`))
  }
  if (node.locked === true) {
    findings.push(finding(LEVEL.INFO, 'STATE', key, '節點被鎖定'))
  }

  return findings
}

/**
 * LOGO_PAIR 那兩支 logo 的尺寸必須一致, 這是下游 checkLogoLightAndLogoDark 的硬要求。
 *
 * @param {Map<string, object>} nodeBySpecKey 用 spec.key 查節點, 不是用 Figma 上的圖層名字 ——
 *                                            圖層可能是用 alias 命名的 (e.g. logo-dark 而不是 logo-brand)
 */
function checkLogoPair(nodeBySpecKey) {
  const [lightKey, darkKey] = LOGO_PAIR
  const light = nodeBySpecKey.get(lightKey)
  const dark = nodeBySpecKey.get(darkKey)
  if (light == null || dark == null) return []

  const lightSize = nodeSize(light)
  const darkSize = nodeSize(dark)
  const same =
    Math.abs(lightSize.width - darkSize.width) < SIZE_TOLERANCE &&
    Math.abs(lightSize.height - darkSize.height) < SIZE_TOLERANCE
  if (same) return []

  return [
    finding(
      LEVEL.ERROR,
      'LOGO-PAIR',
      `${lightKey} / ${darkKey}`,
      `兩支 logo 尺寸必須一致, 但是 ${round(lightSize.width)}x${round(lightSize.height)} 和 ` +
        `${round(darkSize.width)}x${round(darkSize.height)} (下游同步時會被擋)`
    ),
  ]
}

/**
 * 原始點陣圖解析度不足的檢查。
 *
 * 需要先下載原圖才知道解析度, 所以由呼叫端非同步做完再丟進來。
 * 只能拿「資產的最大輸出寬」跟原圖寬比 —— 沒辦法知道那張 fill 在畫面上實際被縮放多少,
 * 所以這條是 warn 不是 error, 避免誤擋可以出的圖。
 */
export function checkSourceResolution(assetKey, maxOutputWidth, sourceImages) {
  return sourceImages
    .filter((image) => image.width != null && image.width < maxOutputWidth)
    .map((image) =>
      finding(
        LEVEL.WARN,
        'SOURCE-RES',
        assetKey,
        `底下有張原圖只有 ${image.width}x${image.height}, 小於最大輸出寬 ${maxOutputWidth}, 放大後會模糊`
      )
    )
}

function isInteger(value) {
  return Math.abs(value - Math.round(value)) < 1e-6
}

function round(value) {
  return Math.round(value * 100) / 100
}
