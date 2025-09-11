import puppeteer from 'puppeteer'
import fs from 'fs'
import path from 'path'
import { compareImages } from './image-compare.js'

const desktopDropdownSelector = `header > nav.navigation .dropdown-container`
const desktopToolboxDropdownSelector = '.header-tool-box > .header-dropdown'
const mobileCollapseDropdownSelector = `.group-container > .collapse.mobile-header-dropdown`
const mobileMenuIconSelector = '#header-view > div > header > div.header-right > div.icon-wrap > div > svg.icon-menu'
const defaultDelay = 350

function genDiffPath(p1, p2, folder) {
  return path.resolve(folder, `${path.parse(p1).name}-${path.parse(p2).name}.png`)
}

async function captureScreenshots(targets) {
  const dir = path.join(process.cwd(), 'screen-shot')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  console.log('screen-shot 資料夾檢查/創建完成')

  const browser = await puppeteer.launch()
  console.log('puppeteer.launch 完成')

  const resultList = []
  const fileNameList = []
  for (const target of targets) {
    if (target instanceof CompareBehavior) {
      const compareResultList = []
      console.log('👯‍♀️ 要做比較')
      const { fileNameList: image1 } = await captureScreenshots([target.image1])
      const { fileNameList: image2 } = await captureScreenshots([target.image2])

      for (let i = 0; i < image1.length; i++) {
        const img1 = image1[i]
        const img2 = image2[i]

        if (!fs.existsSync(img1) || !fs.existsSync(img2)) continue

        const diffPath = genDiffPath(img1, img2, dir)
        const compareResult = await compareImages(img1, img2, diffPath)
        if (compareResult.isDiff) console.log('💥 有差異!', img1, img2)
        compareResultList.push({ isDiff: compareResult.isDiff, img1, img2, compareResult })
      }

      await browser.close()
      resultList.push(compareResultList)
      continue
    }

    const versions = [{ isMobile: true }, { isMobile: false }]

    for (const version of versions) {
      console.log(`🚀 開始處理: ${target.filename} - ${version.isMobile ? 'mobile' : 'desktop'}`)
      const page = await browser.newPage()

      await setDevice(page, { version })

      console.log(`🌐 前往網址: ${target.url}`)
      await page.goto(target.url)
      if (target.token) {
        console.log(`🔐 設定 token: ${target.token}`)
        await page.evaluate((token) => {
          window.localStorage.setItem('token', token)
        }, target.token)
      }

      await page.goto(target.url, { waitUntil: 'networkidle2' })

      await delay(3000)

      // 處理掉像是 CookieSetting 等等的框
      await handleExtraEvents(page)

      const timestamp = Date.now()
      let basicScreenshot = []
      let desktopDropdownScreenshot = []
      let mobileDropdownScreenshot = []

      // 處理基本的畫面截圖: 單一畫面、全幅畫面、scroll 一些些的畫面(查看 header 顏色變化)
      basicScreenshot = await handleBasicScreenshot(page, { target, dir, version, timestamp })

      if (!version.isMobile) {
        desktopDropdownScreenshot = await handleDesktopDropdownScreenshot(page, { dir, target, timestamp })
      } else {
        mobileDropdownScreenshot = await handleMobileDropdownScreenshot(page, { dir, target, timestamp })
      }

      fileNameList.push(...[...basicScreenshot, ...desktopDropdownScreenshot, ...mobileDropdownScreenshot])

      console.log(`✔️ 完成: ${target.filename} - ${version.isMobile ? 'mobile' : 'desktop'} \n`)
      await page.close()
    }
  }
  await browser.close()
  console.log('✅ 所有任務已完成')

  return { resultList, fileNameList }
}

async function delay(delayMs = defaultDelay) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

async function setDevice(page, { version }) {
  if (version.isMobile) {
    console.log('📱 設定為行動裝置模式')
    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 13_6 like Mac OS X) ' +
        'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.2 Mobile/15E148 Safari/604.1'
    )
    await page.setViewport({ width: 375, height: 812, isMobile: true, deviceScaleFactor: 1 })
  } else {
    console.log('🖥️ 設定為桌面裝置大小 1366x768')
    await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 })
  }
}

async function handleMobileDropdownScreenshot(page, { dir, target, timestamp }) {
  const fileNameList = []
  try {
    console.log('📱 嘗試點擊手機版漢堡選單')
    await page.click(mobileMenuIconSelector)
    await delay()
    const mobileMenuPath = path.join(dir, `${target.filename}-${timestamp}-mobile-menu.png`)
    await page.screenshot({ path: mobileMenuPath, fullPage: false })
    console.log(`📸 手機版側邊欄截圖儲存至: ${mobileMenuPath}`)

    const dropdowns = await page.$$(mobileCollapseDropdownSelector)
    console.log(`📱 找到 ${dropdowns.length} 個 collapse dropdown`)
    for (let i = 0; i < dropdowns.length; i++) {
      try {
        console.log(`👉 點擊第 ${i + 1} 個 collapse dropdown`)
        await page.evaluate((dom) => dom.scrollIntoView(), dropdowns[i])
        await dropdowns[i].click()
        await delay()
        const mobileDropdownPath = path.join(dir, `${target.filename}-${timestamp}-mobile-dropdown-${i}.png`)
        await page.screenshot({ path: mobileDropdownPath, fullPage: false })
        console.log(`📸 mobile dropdown 截圖儲存至: ${mobileDropdownPath}`)
        fileNameList.push(mobileDropdownPath)
      } catch (err) {
        console.error(`❌ 點擊第 ${i + 1} 個 collapse dropdown 出錯:`, err)
      }
    }
  } catch (err) {
    console.error('❌ 點擊手機版漢堡選單時發生錯誤:', err)
  }

  return fileNameList
}

async function handleDesktopDropdownScreenshot(page, { dir, target, timestamp }) {
  const fileNameList = []

  const dropdownHandles = await page.$$(desktopDropdownSelector)
  const dropdownToolboxHandles = await page.$$(desktopToolboxDropdownSelector)
  console.log(`🔽 找到 ${dropdownHandles.length} 個 dropdown, ${dropdownToolboxHandles.length} 個 dropdown toolbox`)

  const hoverItems = [...dropdownHandles, ...dropdownToolboxHandles]
  for (let i = 0; i < hoverItems.length; i++) {
    const handle = hoverItems[i]
    try {
      console.log(`➡️ hover 第 ${i + 1} 個 dropdown`)
      await broswerMouseenter(handle, { page })
      await delay()
      const hoverShotPath = path.join(dir, `${target.filename}-${timestamp}-desktop-dropdown-${i}.png`)
      await page.screenshot({ path: hoverShotPath, fullPage: false })
      await browserMouseleave(handle, { page })
      await delay()
      console.log(`📸 dropdown 截圖儲存至: ${hoverShotPath}`)
      fileNameList.push(hoverShotPath)
    } catch (err) {
      console.error(`❌ hover 第 ${i + 1} 個 dropdown 時出錯:`, err)
    }
  }

  return fileNameList
}

async function handleExtraEvents(page) {
  console.log('🍪 處理掉 Cookie 的框')
  await page.evaluate(async (defaultDelay) => {
    const cookieBtn = window.document.querySelector('.cookie-consent-button:not(.outline)')
    if (cookieBtn != null) cookieBtn.click()
    await new Promise((r) => setTimeout(r, defaultDelay))
  }, defaultDelay)
}

async function handleBasicScreenshot(page, { target, dir, version, timestamp }) {
  const baseFilename = `${target.filename}-${version.isMobile ? 'mobile' : 'desktop'}-${timestamp}`
  const firstScreenPath = path.join(dir, `${baseFilename}-first.png`)
  const fullScreenPath = path.join(dir, `${baseFilename}-full.png`)
  const scrollScreenPath = path.join(dir, `${baseFilename}-scroll.png`)
  await 無捲動截圖()

  // TODO(flyc): 暫時先不用
  !console && (await 整個畫面截圖())
  !console && (await 捲動一些截圖()) // TODO(flyc): 還是失效的

  return [firstScreenPath, fullScreenPath, scrollScreenPath]

  async function 無捲動截圖() {
    console.log('🖼️ 僅截取第一個畫面 (無捲動)')
    await page.screenshot({ path: firstScreenPath, fullPage: false })
    console.log(`📸 截圖儲存至: ${firstScreenPath}`)
  }

  async function 整個畫面截圖() {
    console.log('🖼️ 截取整個頁面')
    await page.screenshot({ path: fullScreenPath, fullPage: true })
    console.log(`📸 截圖儲存至: ${fullScreenPath}`)
  }

  async function 捲動一些截圖() {
    await page.evaluate(() => window.document.querySelector('html').scroll({ x: 0, y: 300 }))
    console.log('🖼️ 擷取捲動一些些後的畫面')
    await page.screenshot({ path: scrollScreenPath, fullPage: false })
    console.log(`📸 截圖儲存至: ${scrollScreenPath}`)
  }
}

async function broswerMouseenter(dom, { page }) {
  return page.evaluate((dom) => {
    const enterEvent = new window.MouseEvent('mouseenter', { bubbles: true, cancelable: true })
    dom.dispatchEvent(enterEvent)
  }, dom)
}

async function browserMouseleave(dom, { page }) {
  return page.evaluate((dom) => {
    const leaveEvent = new window.MouseEvent('mouseleave', { bubbles: true, cancelable: true })
    dom.dispatchEvent(leaveEvent)

    const actionIconDom = dom.querySelector('.action-icon')
    if (actionIconDom != null) actionIconDom.dispatchEvent(leaveEvent)
  }, dom)
}

class ClassicBehavior {
  constructor(payload) {
    const { filename = null, url = null, token = null } = payload ?? {}
    if (filename == null) throw new Error(`[${this.constructor.name}] 'filename' 不可為空`)
    if (url == null) throw new Error(`[${this.constructor.name}] 'url' 不可為空`)

    this.filename = filename
    this.url = url
    this.token = token
  }
}

class CompareBehavior {
  constructor(payload) {
    const { image1, image2, diffPath } = payload ?? {}
    if (!(image1 instanceof ClassicBehavior))
      throw new Error(`[${this.constructor.name}] 'image1' 需為 ClassicBehavior 實例`)
    if (!(image2 instanceof ClassicBehavior))
      throw new Error(`[${this.constructor.name}] 'image2' 需為 ClassicBehavior 實例`)

    this.image1 = image1
    this.image2 = image2
    this.diffPath = diffPath ?? null
  }
}

const list = [
  new CompareBehavior({
    image1: new ClassicBehavior({
      filename: 'bitkub-login-local',
      url: 'http://localhost:8081/en',
      token: '',
    }),
    image2: new ClassicBehavior({
      filename: 'bitkub-login-stage',
      url: 'https://bitkub.btse.co/en',
      token: '',
    }),
  }),

  new CompareBehavior({
    image1: new ClassicBehavior({
      filename: 'bitkub-login-local',
      url: 'http://localhost:8081/en',
      token:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NDU4OTMxNjYsImV4cCI6MTc0NTk3OTYyNiwiaXNzIjoiYnRzZS5zdGFnaW5nIiwiYXVkIjoiY2xpZW50LnNlcnZpY2UiLCJ1c2VybmFtZSI6ImZseWNjaHVuZ2JpdGt1YkBiaXRrdWIiLCJjbGllbnRJZCI6ImJpdGt1YiIsInJhbmRvbSI6IjAuODYyNTUyODE0MTc4NTQwNSIsImRldmljZVR5cGUiOiJ3ZWIiLCJkZXZpY2VJZCI6bnVsbCwic2NvcGVzIjpbInRydXN0ZWQiXX0.u3dWRQvn-uqr_cwDDkIh5db7ykgh8MKZa8EvgQzBCHM',
    }),
    image2: new ClassicBehavior({
      filename: 'bitkub-login-stage',
      url: 'https://bitkub.btse.co/en',
      token:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NDU4OTMxNjYsImV4cCI6MTc0NTk3OTYyNiwiaXNzIjoiYnRzZS5zdGFnaW5nIiwiYXVkIjoiY2xpZW50LnNlcnZpY2UiLCJ1c2VybmFtZSI6ImZseWNjaHVuZ2JpdGt1YkBiaXRrdWIiLCJjbGllbnRJZCI6ImJpdGt1YiIsInJhbmRvbSI6IjAuODYyNTUyODE0MTc4NTQwNSIsImRldmljZVR5cGUiOiJ3ZWIiLCJkZXZpY2VJZCI6bnVsbCwic2NvcGVzIjpbInRydXN0ZWQiXX0.u3dWRQvn-uqr_cwDDkIh5db7ykgh8MKZa8EvgQzBCHM',
    }),
  }),

  new CompareBehavior({
    image1: new ClassicBehavior({
      filename: 'autotrader-login-local',
      url: 'http://localhost:8080/en',
      token:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NDU5MDcwNzEsImV4cCI6MTc0NTk5MzUzMSwiaXNzIjoiYnRzZS5zdGFnaW5nIiwiYXVkIjoiY2xpZW50LnNlcnZpY2UiLCJ1c2VybmFtZSI6ImZjY29weXdpc2VAY29weXdpc2UiLCJjbGllbnRJZCI6ImNvcHl3aXNlIiwicmFuZG9tIjoiMC4zNzYxNDE0MjcxMzQwMTMiLCJkZXZpY2VUeXBlIjoid2ViIiwiZGV2aWNlSWQiOm51bGwsInNjb3BlcyI6WyJ0cnVzdGVkIl19.9b00xJyI8-oLoGnTDaYMJOU_sDK1xWGxvo2KMNJK3Hw',
    }),
    image2: new ClassicBehavior({
      filename: 'autotrader-login-stage',
      url: 'https://autotrader.btse.co/en',
      token:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NDU5MDcwNzEsImV4cCI6MTc0NTk5MzUzMSwiaXNzIjoiYnRzZS5zdGFnaW5nIiwiYXVkIjoiY2xpZW50LnNlcnZpY2UiLCJ1c2VybmFtZSI6ImZjY29weXdpc2VAY29weXdpc2UiLCJjbGllbnRJZCI6ImNvcHl3aXNlIiwicmFuZG9tIjoiMC4zNzYxNDE0MjcxMzQwMTMiLCJkZXZpY2VUeXBlIjoid2ViIiwiZGV2aWNlSWQiOm51bGwsInNjb3BlcyI6WyJ0cnVzdGVkIl19.9b00xJyI8-oLoGnTDaYMJOU_sDK1xWGxvo2KMNJK3Hw',
    }),
  }),
]

const { error, ...res } = await captureScreenshots(list)
  .then((data) => ({ data }))
  .catch((error) => ({ error }))
if (error) console.log(error)
console.log(res.data.resultList.forEach((item) => console.log(item.filter((item) => item.isDiff))))
