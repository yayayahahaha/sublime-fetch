// REST /v1/images 的 scale 上限是 4, 但 Figma UI 上手動輸入 512w 是沒有上限的,
// 所以「節點小、輸出大」的組合 (e.g. 64x64 的 PWA_icon 要出 512) 只能靠本機補。
//
// 做法是拿 Figma 的 SVG (向量, 沒有解析度問題) 用 Chromium 畫成指定尺寸的 PNG。
// 這條路的 antialiasing 是 Chromium 算的, 和 Figma 自己算的會有極細微差異,
// 所以呼叫端一定要在 console 標示哪幾張是這樣來的。

let browserPromise = null

async function getBrowser() {
  if (browserPromise == null) {
    const { default: puppeteer } = await import('puppeteer')
    browserPromise = puppeteer.launch({ headless: true })
  }
  return browserPromise
}

export async function closeRasterizer() {
  if (browserPromise == null) return
  const browser = await browserPromise
  browserPromise = null
  await browser.close()
}

/**
 * @param {string} svg      Figma 給的 SVG 原始內容
 * @param {number} width    目標像素寬
 * @param {number} height   目標像素高
 * @returns {Promise<Buffer>} PNG bytes
 */
export async function rasterizeSvgToPng(svg, { width, height }) {
  const browser = await getBrowser()
  const page = await browser.newPage()

  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 })

    const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
    await page.setContent(
      `<!doctype html><html><body style="margin:0;padding:0">` +
        `<img id="target" src="${dataUri}" style="display:block;width:${width}px;height:${height}px">` +
        `</body></html>`,
      { waitUntil: 'load' }
    )

    // setContent 的 load 不保證 img 已經 decode 完, 沒等就可能拍到空白
    // 這個 callback 是在 Chromium 裡跑的, document 不是 node 的 global
    /* global document */
    await page.evaluate(async () => {
      const img = document.getElementById('target')
      if (!img.complete) await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
      })
      if (img.decode != null) await img.decode()
    })

    // omitBackground 讓 SVG 本身透明的地方保持透明; 有底色的資產 SVG 裡就自帶 rect, 不受影響
    return await page.screenshot({ type: 'png', omitBackground: true })
  } finally {
    await page.close()
  }
}
