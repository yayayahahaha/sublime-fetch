// REST /v1/images 的 scale 硬上限 (超過會回 400), 超過的輸出只能走 SVG → 本機 rasterize
export const REST_SCALE_MAX = 4

// export-area 第一層裡這些 type 才算「圖片」, 其它 type 一律視為結構問題
export const ASSET_NODE_TYPES = ['FRAME', 'COMPONENT', 'INSTANCE']

// 第一層的 TEXT 都是設計寫給人看的標註 (e.g. '16*16', 'width: 240'), 直接丟棄不檢查
export const IGNORED_NODE_TYPES = ['TEXT']

export const PAGE_NAME_KEYWORD = 'asset'
export const EXPORT_AREA_NAME = 'export-area'

/**
 * 圖層名字比對前先正規化: 轉小寫、去掉 - _ 和空白。
 *
 * 這樣 `PWA_icon` / `pwa-icon` / `pwa_icon` / `PWA Icon` 全都是同一個,
 * 設計不用記分隔符號和大小寫。刻意不用 regexp 當 matcher ——
 * regexp 容易過度命中 (e.g. /logo/i 會同時打到 logo-light、_wl-logo、qrcode-logo),
 * 正規化後做完全比對則不可能誤傷別人。
 */
export function normalizeLayerName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[\s\-_]/g, '')
}

/** 一筆 spec 接受哪些 Figma 圖層名字 */
export function specAliases(spec) {
  return [spec.key, ...(spec.aliases ?? [])]
}

/** 這個圖層名字算不算這筆 spec */
export function matchesSpec(spec, nodeName) {
  const normalized = normalizeLayerName(nodeName)
  return specAliases(spec).some((alias) => normalizeLayerName(alias) === normalized)
}

const EXT_BY_FORMAT = {
  PNG: 'png',
  SVG: 'svg',
  ICO: 'ico',
}

/**
 * key 是 Figma 上 export-area 第一層的 node.name。
 * 輸出檔名 = `${outputName ?? key}${suffix}.${ext}`, 這是 Figma 自己 export 的檔名慣例,
 * 刻意對齊 figma-utils.js 的 FIGMA_IMAGES.filename, 所以這裡的產出可以直接
 * 丟進 figma-images/ 讓既有的「一次同步」流程接手, 下游一行都不用改。
 *
 * 改這張表的時候記得同步 DESIGN_CHECKLIST.md —— 那份是給設計看的圖層命名清單。
 *
 * expect  : 節點本身應有的尺寸, null 代表各 brand 自由 (logo 就是)
 * aliases : 除了 key 以外還接受哪些圖層名字。名字比對前會正規化 (小寫 + 去掉 - _ 空白),
 *           所以純粹是大小寫或分隔符號的差異不用寫進來, 這裡只放「真的不同的字」
 *           (e.g. logo-brand 和 logo-dark)。命中多個不同名字時會報 MULTI-MATCH
 * outputName : 輸出檔名的前綴, 只有在「Figma 上的圖層名字」和「我們要的檔名」不一樣時才需要,
 *              不給就等於 key。設計端的命名習慣和 FE 的 usage 不必綁在一起
 * opaque  : 應該要有不透明底色 (PWA / Favicon 那套, 不是透明背景的 Support 那套)
 * exports : 每個項目產生一個檔案
 *             format: 'PNG' | 'SVG' | 'ICO'
 *             width : 目標像素寬 (會用節點尺寸換算成 REST 需要的 scale)
 *             scale : 直接指定倍率, 與 width 二選一
 *             sizes : 只有 ICO 用, 要內嵌哪幾個尺寸
 *             suffix: 檔名後綴, 預設 ''
 */
export const EXPORT_MAP = [
  {
    // 設計端改叫 pwa-icon。正規化比對讓舊的 PWA_icon 也還是會命中, 所以不用等 Figma 改完才能用。
    // 但輸出檔名要維持 PWA_icon16.png ── 下游 figma-utils.js 的 FIGMA_IMAGES 在等這個名字
    key: 'pwa-icon',
    outputName: 'PWA_icon',
    expect: { width: 64, height: 64 },
    opaque: true,
    // 48 / 156 下游的 FIGMA_IMAGES 目前用不到, 但既然 Figma 上本來就有就一起帶出來
    exports: [
      { format: 'PNG', width: 16, suffix: '16' },
      { format: 'PNG', width: 32, suffix: '32' },
      { format: 'PNG', width: 48, suffix: '48' },
      { format: 'PNG', width: 150, suffix: '150' },
      { format: 'PNG', width: 156, suffix: '156' },
      { format: 'PNG', width: 180, suffix: '180' },
      { format: 'PNG', width: 192, suffix: '192' },
      // 64x64 的節點要出 512 是 8x, 超過 REST 上限, 會自動改走 SVG → 本機 rasterize
      { format: 'PNG', width: 512, suffix: '512' },
    ],
  },
  {
    key: 'favicon',
    expect: { width: 64, height: 64 },
    opaque: true,
    // .ico 以前要設計另外用 ICO exporter 轉好丟 PRD 附件, 現在直接自己編碼
    //
    // 注意: 現有 production 的 favicon.ico 其實內嵌了 4 個尺寸 (16/32/48/64, BMP payload, 32KB),
    // 這裡按需求只出 64。favicon 節點本身是 64x64, 所以 16/32/48 換算後的 scale 都在 REST 上限內,
    // 要跟 production 一致的話把 sizes 改成 [16, 32, 48, 64] 就好, 沒有額外成本。
    exports: [{ format: 'SVG' }, { format: 'ICO', sizes: [64] }],
  },
  {
    key: 'img-social-a',
    expect: { width: 400, height: 400 },
    exports: [{ format: 'PNG', scale: 1 }],
  },
  {
    key: 'img-social-b',
    expect: { width: 1200, height: 675 },
    exports: [{ format: 'PNG', scale: 1 }],
  },
  {
    key: 'qrcode-logo',
    expect: { width: 13, height: 13 },
    exports: [{ format: 'SVG' }],
  },
  // 兩支 logo 的設計端命名和 FE 的 usage 不一樣, 靠 outputName 接起來:
  //   Figma: logo-white / logo-brand   (設計覺得這樣更符合語意)
  //   檔名 : logo-light / logo-dark    (FE 的 usage, 下游 LOGO_SOURCE_FILE_NAMES 在等這個)
  // aliases 收舊名字是為了兩種寫法都能用, 不用等 Figma 改完才能跑。
  //
  // logo 尺寸各 brand 不同 (headerLogoHeight 會跟著 logo 高度更新), 所以不檢查絕對尺寸,
  // 但兩支之間必須一致 (下游 checkLogoLightAndLogoDark 的硬要求)
  {
    key: 'logo-white',
    aliases: ['logo-light'],
    outputName: 'logo-light',
    expect: null,
    exports: [{ format: 'SVG' }, { format: 'PNG', scale: 2 }],
  },
  {
    key: 'logo-brand',
    aliases: ['logo-dark'],
    outputName: 'logo-dark',
    expect: null,
    exports: [{ format: 'SVG' }, { format: 'PNG', scale: 2 }],
  },
]

// 尺寸必須一致的成對檢查, 這裡放的是 spec.key (不是 Figma 上的圖層名, 圖層可能用 alias 命名)
export const LOGO_PAIR = ['logo-white', 'logo-brand']

/** @param {object} spec EXPORT_MAP 裡的一筆, 不是單純的 key —— 檔名前綴可能被 outputName 蓋掉 */
export function exportFileName(spec, exportItem) {
  const ext = EXT_BY_FORMAT[exportItem.format]
  return `${outputBaseName(spec)}${exportItem.suffix ?? ''}.${ext}`
}

export function outputBaseName(spec) {
  return spec.outputName ?? spec.key
}

// 給 console 用的簡短描述, e.g. 'PNG 512w' / 'PNG @2x' / 'SVG' / 'ICO 16+32'
export function exportItemLabel(exportItem) {
  if (exportItem.sizes != null) return `${exportItem.format} ${exportItem.sizes.join('+')}`
  if (exportItem.width != null) return `${exportItem.format} ${exportItem.width}w`
  if (exportItem.scale != null && exportItem.scale !== 1) return `${exportItem.format} @${exportItem.scale}x`
  return exportItem.format
}

/**
 * 一個 export 項目要向 Figma 要幾張圖。
 *
 * PNG / SVG 各一張; ICO 每個內嵌尺寸各要一張 PNG 當 payload。
 * scale 超過 REST 上限時改成拿 SVG 回來本機 rasterize, 這時 targetWidth / targetHeight
 * 就是 rasterize 的目標尺寸。
 */
export function resolveRenderPlans(exportItem, nodeSize) {
  if (exportItem.format === 'SVG') {
    return [{ renderFormat: 'SVG', scale: null, local: false, targetWidth: null, targetHeight: null }]
  }

  if (exportItem.format === 'ICO') {
    return (exportItem.sizes ?? [64]).map((size) => rasterPlan({ width: size }, nodeSize))
  }

  return [rasterPlan(exportItem, nodeSize)]
}

function rasterPlan(spec, nodeSize) {
  const { width: nodeWidth, height: nodeHeight } = nodeSize

  let scale
  let targetWidth
  let targetHeight
  if (spec.width != null) {
    scale = spec.width / nodeWidth
    targetWidth = spec.width
    targetHeight = Math.round((nodeHeight / nodeWidth) * spec.width)
  } else {
    scale = spec.scale ?? 1
    targetWidth = Math.round(nodeWidth * scale)
    targetHeight = Math.round(nodeHeight * scale)
  }

  if (scale > REST_SCALE_MAX) {
    // 拿 SVG 回來自己畫, 這條路 Chromium 算的 antialiasing 會和 Figma 有極細微差異
    return { renderFormat: 'SVG', scale: null, local: true, targetWidth, targetHeight }
  }

  return { renderFormat: 'PNG', scale, local: false, targetWidth, targetHeight }
}

/** 這個資產所有輸出裡最大的目標像素寬, 給 SOURCE-RES 檢查用 */
export function maxOutputWidth(spec, nodeSize) {
  const widths = spec.exports
    .flatMap((exportItem) => resolveRenderPlans(exportItem, nodeSize))
    .map((plan) => plan.targetWidth ?? 0)
  return Math.max(0, ...widths)
}
