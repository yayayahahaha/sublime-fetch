import path from 'path'
import fs from 'fs'
import select from '@inquirer/select'
import { JSDOM } from 'jsdom'
import {
  checkSetting,
  consoleGreen,
  consolePathHint,
  consoleRed,
  consoleStep,
  consoleYellow,
  copyFileEnsureDir,
  ensureDir,
  high,
  isDir,
  readSetting,
} from './utils.js'
import { resolveBrand } from './brand-utils.js'

const logoLightInfo = {
  fileName: 'logo-light.svg',
  pngFileName: 'logo-light.png',
  componentName: 'LogoLight',
}
const logoDarkInfo = {
  fileName: 'logo-dark.svg',
  pngFileName: 'logo-dark.png',
  componentName: 'LogoDark',
}
const logos = [logoLightInfo, logoDarkInfo]

// Figma 上叫 qrcode-logo (13x13), 產出 AppIcon.vue
const appIconInfo = {
  fileName: 'qrcode-logo.svg',
  componentName: 'AppIcon',
}

// 維護頁的 logo: bundle/maintenance-mode/image/<brand>-logo.svg
// 維護頁背景是淺色 (多數 brand 是 #f0f4f8), 所以沿用 logo-dark.svg
const maintenanceLogoInfo = {
  sourceFileName: logoDarkInfo.fileName,
  imageDir: path.join('bundle', 'maintenance-mode', 'image'),
  indexHtml: path.join('bundle', 'maintenance-mode', 'index.html'),
}

// Logo 需要的原始檔案 (svg + png)
export const LOGO_SOURCE_FILE_NAMES = logos.flatMap((logoInfo) => [logoInfo.fileName, logoInfo.pngFileName])
export const APP_ICON_SOURCE_FILE_NAME = appIconInfo.fileName

function resolveLogoSource(fileName, { newImagesFolder, sourceFiles } = {}) {
  return sourceFiles?.[fileName] ?? path.resolve('.', newImagesFolder, 'logos', fileName)
}

const VUE_ICON_TEMPLATE_BY_LANG = {
  js: 'VUE_ICON_TEMPLATE.txt',
  ts: 'VUE_ICON_TEMPLATE_TS.txt',
}
const LOGO_TEMPLATE_FILE_NAME = 'LOGO_TEMPLATE.txt'
const APP_ICON_TEMPLATE_FILE_NAME = 'APP_ICON_TEMPLATE.txt'

export async function svgLogoStuff() {
  const settings = readSetting()
  if (settings == null) return

  const {
    ok,
    frontendRepoPath,
    newImagesFolder,
    targetBrand: settingBrand,
  } = checkSetting(settings, ['frontend-repo-path', 'new-images-folder', 'target-brand'])
  if (!ok) return
  consoleStep('setting')

  const targetBrand = await resolveBrand({ settingBrand, frontendRepoPath })
  if (targetBrand == null) return
  consoleStep(`target-brand = ${high(targetBrand)}`)

  const sourceDir = path.resolve('.', newImagesFolder, 'logos')
  const targetDir = path.resolve(frontendRepoPath, 'src', `brand-${targetBrand}`, 'component')
  consolePathHint({
    sourceLines: [
      `${high(sourceDir)}`,
      `${high('logo-light.svg')}, ${high('logo-dark.svg')}, ${high(APP_ICON_SOURCE_FILE_NAME)}`,
    ],
    targetLines: [
      `${high(targetDir)}`,
      `${high('LogoLight.vue')}, ${high('LogoDark.vue')}, ${high('AppIcon.vue')}`,
      `${high(path.resolve(frontendRepoPath, 'src', `brand-${targetBrand}`, maintenanceLogoInfo.imageDir))}`,
      `${high(`${targetBrand}-logo.svg`)} (維護頁, 來自 logo-dark.svg)`,
    ],
  })

  if (!isDir(newImagesFolder)) {
    return void consoleRed(`${newImagesFolder} 需為一個資料夾!`)
  }
  consoleStep(`${newImagesFolder} 為資料夾`)

  const logoInstanceList = checkLogoLightAndLogoDark(newImagesFolder, {
    frontendRepoPath,
    targetBrand,
  })
  if (logoInstanceList.length === 0) {
    return void consoleRed('Logo 檢查未通過，請修正以上問題後再執行')
  }
  consoleStep('Logo 來源檔案存在與尺寸一致')

  const appIconInstance = checkAppIcon(newImagesFolder, { frontendRepoPath, targetBrand })
  if (!appIconInstance.exist) {
    return void consoleRed('AppIcon 來源檢查未通過，請修正以上問題後再執行')
  }
  consoleStep(`${APP_ICON_SOURCE_FILE_NAME} 存在`)

  const maintenanceLogo = checkMaintenanceLogo(newImagesFolder, { frontendRepoPath, targetBrand })
  if (maintenanceLogo != null && !maintenanceLogo.exist) {
    return void consoleRed('維護頁 logo 來源檢查未通過，請修正以上問題後再執行')
  }

  const makeSure = await select({
    message: '檢查完畢，即將開始修改 LogoLight / LogoDark / AppIcon / 維護頁 logo，請確認清空 frontend repo 的 git status',
    choices: [
      {
        name: '我還沒清完，等等再做',
        value: false,
      },
      {
        name: '清除完畢，開始吧',
        value: true,
      },
    ],
  }).catch(() => false)
  if (!makeSure) return

  await syncLogoLightAndDark(logoInstanceList, {
    targetBrand,
    frontendRepoPath,
  })
  consoleGreen(`共 ${logoInstanceList.length} 個 Logo 元件處理完畢!`)

  syncAppIcon(appIconInstance)
  consoleGreen('AppIcon.vue 處理完畢!')

  syncMaintenanceLogo(maintenanceLogo)
  if (maintenanceLogo != null) consoleGreen(`維護頁的 ${maintenanceLogo.targetFileName} 處理完畢!`)
}

// S3 那邊的
export async function s3LogStuff() {
  const settings = readSetting()
  if (settings == null) return

  const {
    ok,
    frontendRepoPath,
    s3RepoPath,
    newImagesFolder,
    targetBrand: settingBrand,
  } = checkSetting(settings, ['frontend-repo-path', 's3-repo-path', 'new-images-folder', 'target-brand'])
  if (!ok) return
  consoleStep('setting')

  const targetBrand = await resolveBrand({ settingBrand, frontendRepoPath, s3RepoPath })
  if (targetBrand == null) return
  consoleStep(`target-brand = ${high(targetBrand)}`)

  const sourceDir = path.resolve('.', newImagesFolder, 'logos')
  const targetDir = path.resolve(s3RepoPath, targetBrand)
  consolePathHint({
    sourceLines: [
      `${high(sourceDir)}`,
      `${high('logo-light.png')}, ${high('logo-light.svg')}, ${high('logo-dark.png')}, ${high('logo-dark.svg')}`,
    ],
    targetLines: [`${high(targetDir)}`, `額外複製 png 到 ${high(path.join(targetDir, 'email'))}`],
  })

  if (!isDir(newImagesFolder)) {
    return void consoleRed(`${newImagesFolder} 需為一個資料夾!`)
  }
  consoleStep(`${newImagesFolder} 為資料夾`)

  const logoInstanceList = checkS3Logos(newImagesFolder, {
    s3RepoPath,
    targetBrand,
  })
  if (logoInstanceList.length === 0) {
    return void consoleRed('Logo 檢查未通過，請修正以上問題後再執行')
  }
  consoleStep(`Logo 來源檔案存在 (png + svg)`)

  const makeSure = await select({
    message: '檢查完畢，即將開始把 Logo 寫入 s3 repo，請確認清空 s3 repo 的 git status',
    choices: [
      {
        name: '我還沒清完，等等再做',
        value: false,
      },
      {
        name: '清除完畢，開始吧',
        value: true,
      },
    ],
  }).catch(() => false)
  if (!makeSure) return

  logoInstanceList.forEach((payload) => {
    const { extraBehavior } = payload

    extraBehavior.forEach((behavior) => behavior())
  })

  consoleGreen(`共 ${logoInstanceList.length} 個 Logo 處理完畢!`)
}

/**
 * @param {object} options
 * @param {Record<string, string>} [options.sourceFiles] 以 logo 檔名為 key、來源絕對路徑為 value 的 map,
 *                                                       傳入時就直接檢查這些檔案, 不會去讀 new-images/logos
 */
export function checkS3Logos(newImagesFolder, { s3RepoPath, targetBrand, sourceFiles = null } = {}) {
  const formatedLogoInfo = logos.reduce((acc, logoInfo) => {
    const logoPath = resolveLogoSource(logoInfo.pngFileName, { newImagesFolder, sourceFiles })
    const logoPathSvg = resolveLogoSource(logoInfo.fileName, { newImagesFolder, sourceFiles })
    const exist = fs.existsSync(logoPath)
    const existSvg = fs.existsSync(logoPathSvg)
    if (!exist) {
      consoleRed(`${logoInfo.pngFileName} 不存在於 ${path.dirname(logoPath)} !`)
    }
    if (!existSvg) {
      consoleRed(`${logoInfo.fileName} 不存在於 ${path.dirname(logoPathSvg)} !`)
    }

    const newFilePath = logoPath
    const newFilePathSvg = logoPathSvg
    const targetPath = path.resolve(s3RepoPath, targetBrand, logoInfo.pngFileName)
    const targetPathSvg = path.resolve(s3RepoPath, targetBrand, logoInfo.fileName)
    const targetPathEmail = path.resolve(s3RepoPath, targetBrand, 'email', logoInfo.pngFileName)

    // 資料夾在真正寫入時才建立, 檢查階段不動到 s3 repo
    const extraBehavior = [
      () => copyFileEnsureDir(newFilePath, targetPath),
      () => copyFileEnsureDir(newFilePath, targetPathEmail),
      () => copyFileEnsureDir(newFilePathSvg, targetPathSvg),
    ]

    acc.push(
      new LogoInstance({
        ...logoInfo,
        extraBehavior,
        newFilePath,
        exist: exist && existSvg,
        targetPath,
      })
    )

    return acc
  }, [])

  const allExist = formatedLogoInfo.every((logoInfo) => logoInfo.exist)
  return allExist ? formatedLogoInfo : []
}

export async function svgToVue() {
  const svgFolder = 'svg-to-vue-images'
  const resultFolder = 'svg-to-vue-images-result'

  const scriptLang = await select({
    message: '產生的 vue 裡的 script 要用哪種語言?',
    choices: [
      {
        name: 'JavaScript (<script setup>)',
        value: 'js',
      },
      {
        name: 'TypeScript (<script setup lang="ts">)',
        value: 'ts',
      },
    ],
  }).catch(() => null)
  if (scriptLang == null) return void consoleRed('使用者取消')
  consoleStep(`script 語言 = ${high(scriptLang)}`)

  consolePathHint({
    sourceLines: [high(path.resolve('.', svgFolder))],
    targetLines: [high(path.resolve('.', resultFolder))],
  })

  ensureDir(path.resolve('.', resultFolder))
  if (!fs.existsSync(svgFolder)) return void consoleRed(`資料夾 ${svgFolder} 不存在`)
  if (!isDir(svgFolder)) return void consoleRed(`${svgFolder} 不為資料夾`)
  consoleStep(`${svgFolder} 為資料夾`)

  const svgList = fs
    .readdirSync(svgFolder)
    .filter((filename) => {
      if (path.parse(path.resolve(svgFolder, filename)).ext !== '.svg') {
        consoleYellow(`檔案 ${filename} 不為 svg`)
        return false
      }
      return true
    })
    .map((filename) => ({ filename, filePath: path.resolve(svgFolder, filename) }))
  if (svgList.length === 0) return consoleGreen(`${svgFolder} 為空`)
  consoleStep(`${svgList.length} 個 svg 檔案`)

  svgList.forEach(({ filename, filePath: svgPath }) => {
    const content = fs.readFileSync(svgPath, 'utf8')
    const svgDom = new JSDOM(content)?.window.document.querySelector('svg') ?? null
    if (svgDom == null) return void consoleRed(`${svgPath} 不為 SVG!`)

    const vueStr = svgStrIntoVueStr(content, { filename, scriptLang })
    const parseInfo = path.parse(path.resolve(resultFolder, filename))
    const resultPath = `${path.resolve(parseInfo.dir, parseInfo.name)}.vue`
    fs.writeFileSync(resultPath, vueStr)
    consoleGreen(`${resultPath} 創建完成`)
  })
}

function svgStrIntoVueStr(svgStr, { filename = null, verbose = true, scriptLang = 'js' } = {}) {
  const svgDom = new JSDOM(svgStr)?.window?.document.querySelector('svg') ?? null
  if (svgDom == null) throw new Error(`[svgStrIntoVueStr] svgStr is not a svg format`)

  const { content, ids } = rewriteSvgIds(svgDom, { label: filename, verbose })

  return fillVueTemplate(VUE_ICON_TEMPLATE_BY_LANG[scriptLang] ?? VUE_ICON_TEMPLATE_BY_LANG.js, {
    content,
    ids,
    width: svgDom.getAttribute('width') ?? null,
    height: svgDom.getAttribute('height') ?? null,
    viewBox: svgDom.getAttribute('viewBox'),
    ariaLabel: `icon-${path.parse(filename).name}`,
  })
}

/**
 * 把 svg 裡寫死的 id 換成 runtime 產生的 id (`:id="idN"`), 並把引用它的 `url(#xxx)` 一起改成 template literal,
 * 避免同一個頁面出現多個相同 id 而互相蓋掉。
 *
 * 注意: 會直接修改傳入的 svgDom。
 */
function rewriteSvgIds(svgDom, { label = null, verbose = true } = {}) {
  const domsHasId = svgDom.querySelectorAll('[id]')
  const prefix = label == null ? '' : `${high(label)} `

  if (domsHasId.length === 0) {
    if (verbose) consoleGreen(`${prefix}沒有需要調整的 id`)
    return { content: svgDom.innerHTML, ids: [] }
  }
  if (verbose) consoleGreen(`${prefix}有 ${high(domsHasId.length)} 個需要調整的 id`)

  const ids = []
  domsHasId.forEach((element, index) => {
    ids.push(element.id)
    element.setAttribute(':id', `id${index + 1}`)
    element.removeAttribute('id')
  })

  svgDom.querySelectorAll('*').forEach((element) => {
    element.getAttributeNames().forEach((attrName) => {
      const attrValue = element.getAttribute(attrName)

      ids.forEach((id, index) => {
        if (!attrValue.includes(`url(#${id})`)) return
        element.setAttribute(`:${attrName}`, `\`url(#\${id${index + 1}})\``)
        element.removeAttribute(attrName)
      })
    })
  })

  return { content: svgDom.innerHTML, ids }
}

// 把處理好的 svg 內容填進 vue 模板
// viewBox 用 svg 自己的, 沒有才退回 `0 0 width height` (匯出成 @2x 時 width/height 會和 viewBox 不一致)
function fillVueTemplate(templateFileName, { content, ids, width, height, viewBox, ariaLabel } = {}) {
  let templateContent = fs.readFileSync(path.resolve('.', templateFileName), 'utf8')

  templateContent = templateContent.replace(/___REPLACE_ARIA_LABEL___/, ariaLabel)

  templateContent = templateContent.replace(/___REPLACE_SVG_CONTENT___/, content)

  templateContent = templateContent.replace(/___REPLACE_VIEW_BOX___/g, viewBox ?? `0 0 ${width} ${height}`)
  templateContent = templateContent.replace(/___REPLACE_ICON_WIDTH___/g, width)
  templateContent = templateContent.replace(/___REPLACE_ICON_HEIGHT___/g, height)

  templateContent = templateContent.replace(
    /___REPLACE_UTILS_IMPORT___/,
    ids.length === 0 ? '' : `import { generateId } from '@/utils'`
  )

  templateContent = templateContent.replace(
    /___REPLACE_ID_LIST___/,
    ids.map((_, index) => `const id${index + 1} = generateId()\n`).join('')
  )

  return templateContent
}

export async function syncLogoLightAndDark(logoInstanceList, { targetBrand, frontendRepoPath } = {}) {
  logoInstanceList.forEach((logoInfo) => {
    const { svgDom, fileName, width, height, viewBox, targetPath } = logoInfo
    const { content, ids } = rewriteSvgIds(svgDom, { label: fileName })

    const formatVueContent = fillVueTemplate(LOGO_TEMPLATE_FILE_NAME, {
      content,
      ids,
      width,
      height,
      viewBox,
      ariaLabel: `${targetBrand} Icon`,
    })

    ensureDir(path.dirname(targetPath))
    fs.writeFileSync(targetPath, formatVueContent)
  })

  const generalConfigPath = path.resolve(frontendRepoPath, 'src', `brand-${targetBrand}`, 'generalConfig.js')
  if (!fs.existsSync(generalConfigPath)) {
    consoleYellow(`${generalConfigPath} 不存在，跳過 headerLogoHeight 的更新`)
    return
  }
  const matchedHeightRegexp = /const headerLogoHeight = '?(\d+)'?\n/
  let configContent = fs.readFileSync(generalConfigPath, 'utf8')
  const matchedHeight = configContent.match(matchedHeightRegexp)?.[1] ?? null
  if (matchedHeight == null) {
    consoleYellow(`在 ${generalConfigPath} 找不到 headerLogoHeight，未更新`)
    return
  }
  configContent = configContent.replace(matchedHeightRegexp, function (match) {
    return match.replace(/(\d+)/, logoInstanceList[0].height ?? '$1')
  })
  fs.writeFileSync(generalConfigPath, configContent)
}

/**
 * @param {object} options
 * @param {Record<string, string>} [options.sourceFiles] 以 logo 檔名為 key、來源絕對路徑為 value 的 map,
 *                                                       傳入時就直接檢查這些檔案, 不會去讀 new-images/logos
 */
export function checkLogoLightAndLogoDark(newImagesFolder, { frontendRepoPath, targetBrand, sourceFiles = null } = {}) {
  const formatedLogoInfo = logos.map((logoInfo) =>
    svgSourceIntoInstance(resolveLogoSource(logoInfo.fileName, { newImagesFolder, sourceFiles }), {
      ...logoInfo,
      frontendRepoPath,
      targetBrand,
    })
  )

  const exist = formatedLogoInfo.every((logoInfo) => logoInfo.exist)
  const { widthList, heightList } = formatedLogoInfo.reduce(
    (acc, item) => {
      acc.widthList.push(item.width)
      acc.heightList.push(item.height)
      return acc
    },
    { widthList: [], heightList: [] }
  )
  const sameSize = [...new Set(widthList)].length === 1 && [...new Set(heightList)].length === 1
  if (!sameSize) {
    consoleRed('Logo 的尺寸不一致!')
  }

  return exist && sameSize ? formatedLogoInfo : []
}

/**
 * 來源檔案不存在或不是合法 svg 時, 回傳的 instance 的 exist 會是 false, 呼叫端要視為檢查失敗
 *
 * @param {object} options
 * @param {Record<string, string>} [options.sourceFiles] 以檔名為 key、來源絕對路徑為 value 的 map,
 *                                                       傳入時就直接檢查這些檔案, 不會去讀 new-images/logos
 */
export function checkAppIcon(newImagesFolder, { frontendRepoPath, targetBrand, sourceFiles = null } = {}) {
  const sourcePath = resolveLogoSource(appIconInfo.fileName, { newImagesFolder, sourceFiles })

  return svgSourceIntoInstance(sourcePath, { ...appIconInfo, frontendRepoPath, targetBrand })
}

export function syncAppIcon(appIconInstance) {
  const { svgDom, fileName, width, height, viewBox, targetPath } = appIconInstance
  const { content, ids } = rewriteSvgIds(svgDom, { label: fileName })

  const formatVueContent = fillVueTemplate(APP_ICON_TEMPLATE_FILE_NAME, {
    content,
    ids,
    width,
    height,
    viewBox,
    ariaLabel: 'App Icon',
  })

  ensureDir(path.dirname(targetPath))
  fs.writeFileSync(targetPath, formatVueContent)
}

/**
 * 維護頁的 logo 是 index.html 用 <img> 直接引用的靜態 svg, 不是 vue 元件, 所以不用過 svg -> vue。
 *
 * 回傳 null 代表這個 brand 沒有維護頁、或維護頁沒有引用本地的 logo (例如直接指向 s3 網址), 呼叫端跳過。
 */
export function checkMaintenanceLogo(newImagesFolder, { frontendRepoPath, targetBrand, sourceFiles = null } = {}) {
  const brandPath = path.resolve(frontendRepoPath, 'src', `brand-${targetBrand}`)
  const indexHtmlPath = path.resolve(brandPath, maintenanceLogoInfo.indexHtml)
  if (!fs.existsSync(indexHtmlPath)) {
    consoleYellow(`⚠️  找不到 ${maintenanceLogoInfo.indexHtml}, 跳過維護頁 logo`)
    return null
  }

  const imageDir = path.resolve(brandPath, maintenanceLogoInfo.imageDir)
  const targetFileName = `${targetBrand}-logo.svg`
  const targetPath = path.resolve(imageDir, targetFileName)

  // index.html 裡的檔名是寫死的, 對不上的話就算寫了新檔案也不會被讀到
  const referenced =
    fs.readFileSync(indexHtmlPath, 'utf8').match(/<img[^>]*\ssrc="image\/([^"]*-logo\.svg)"/)?.[1] ?? null
  if (referenced == null) {
    consoleYellow(`⚠️  ${maintenanceLogoInfo.indexHtml} 沒有引用 image/*-logo.svg (可能直接指向網址), 跳過維護頁 logo`)
    return null
  }
  if (referenced !== targetFileName) {
    consoleYellow(
      `⚠️  ${maintenanceLogoInfo.indexHtml} 引用的是 ${high(`image/${referenced}`)}, 但會產生 ${high(targetFileName)} — 對不上, 維護頁會破圖!`
    )
  }

  // 殘留檔案 (通常是從別的 brand 複製資料夾留下來的)
  if (isDir(imageDir)) {
    fs.readdirSync(imageDir)
      .filter((name) => name.endsWith('-logo.svg') && name !== targetFileName)
      .forEach((name) => consoleYellow(`⚠️  ${path.resolve(imageDir, name)} 疑似殘留檔案, 確認後請手動刪除`))
  }

  const sourcePath = resolveLogoSource(maintenanceLogoInfo.sourceFileName, { newImagesFolder, sourceFiles })
  if (!fs.existsSync(sourcePath)) {
    consoleRed(`${maintenanceLogoInfo.sourceFileName} 不存在於 ${path.dirname(sourcePath)} !`)
    return { exist: false }
  }

  return { exist: true, sourcePath, targetPath, targetFileName, ariaLabel: readBrandDisplayName(brandPath) }
}

export function syncMaintenanceLogo(maintenanceLogo) {
  if (maintenanceLogo == null) return

  const { sourcePath, targetPath, ariaLabel } = maintenanceLogo
  const content = maintenanceLogoSvg(fs.readFileSync(sourcePath, 'utf8'), { ariaLabel })
  if (content == null) return void consoleRed(`${sourcePath} 不為 SVG!`)

  ensureDir(path.dirname(targetPath))
  fs.writeFileSync(targetPath, content)
}

/**
 * 維護頁的 logo 直接沿用 logo-dark.svg 的內容, 只做三件事:
 *   1. 移除 width / height, 尺寸交給 style.css 的 .logo 控制
 *   2. 補上 aria-label
 *   3. 把 Figma 每次匯出都會變的 id (clip0_3902_287442) 簡化掉, 重新匯出時才不會產生無意義的 diff
 * 其餘內容保持和來源檔一模一樣 (不重新序列化, 避免動到排版)。
 */
function maintenanceLogoSvg(rawSvg, { ariaLabel = null } = {}) {
  const openTag = rawSvg.match(/<svg\b[^>]*>/)?.[0] ?? null
  if (openTag == null) return null

  let newOpenTag = openTag.replace(/\s+(width|height|aria-label)="[^"]*"/g, '')
  if (ariaLabel != null) {
    newOpenTag = newOpenTag.replace(/\s*(\/?)>$/, ` aria-label="${ariaLabel}"$1>`)
  }

  return simplifyFigmaIds(rawSvg.replace(openTag, () => newOpenTag))
}

// clip0_3902_287442 -> clip0, paint0_linear_3902_287442 -> paint0_linear
function simplifyFigmaIds(svgStr) {
  const ids = [...new Set([...svgStr.matchAll(/\sid="([^"]+)"/g)].map((matched) => matched[1]))]
  const used = new Set()

  return ids.reduce((content, id) => {
    const simplified = id.replace(/_\d+(_\d+)*$/, '')
    // 簡化後撞名或整個被吃掉就維持原樣
    if (simplified.length === 0 || simplified === id || used.has(simplified)) {
      used.add(id)
      return content
    }
    used.add(simplified)

    return content.split(`id="${id}"`).join(`id="${simplified}"`).split(`url(#${id})`).join(`url(#${simplified})`)
  }, svgStr)
}

// 顯示用的名稱, 取 bundle/config.js 的 pwaConfig.name (例如 'LabX')
function readBrandDisplayName(brandPath) {
  const configPath = path.resolve(brandPath, 'bundle', 'config.js')
  if (!fs.existsSync(configPath)) {
    consoleYellow(`⚠️  ${configPath} 不存在, 維護頁 logo 不會帶 aria-label`)
    return null
  }

  const configContent = fs.readFileSync(configPath, 'utf8')
  const pwaConfigIndex = configContent.indexOf('const pwaConfig')
  const displayName =
    pwaConfigIndex < 0 ? null : (configContent.slice(pwaConfigIndex).match(/\bname:\s*'([^']*)'/)?.[1] ?? null)
  if (displayName == null) {
    consoleYellow(`⚠️  在 ${configPath} 找不到 pwaConfig.name, 維護頁 logo 不會帶 aria-label`)
  }

  return displayName
}

// 讀 svg 來源檔並包成 LogoInstance, 檔案不存在或內容不是 svg 時 exist 會是 false
function svgSourceIntoInstance(sourcePath, { componentName, fileName, frontendRepoPath, targetBrand } = {}) {
  const targetPath = path.resolve(frontendRepoPath, 'src', `brand-${targetBrand}`, 'component', `${componentName}.vue`)
  const invalid = new LogoInstance({ componentName, fileName, exist: false, targetPath })

  if (!fs.existsSync(sourcePath)) {
    consoleRed(`${fileName} 不存在於 ${path.dirname(sourcePath)} !`)
    return invalid
  }

  const svgDom = new JSDOM(fs.readFileSync(sourcePath, 'utf8')).window.document.querySelector('svg')
  if (svgDom == null) {
    consoleRed(`${sourcePath} 不為 SVG!`)
    return invalid
  }

  return new LogoInstance({
    componentName,
    fileName,
    exist: true,
    targetPath,
    width: svgDom.getAttribute('width'),
    height: svgDom.getAttribute('height'),
    viewBox: svgDom.getAttribute('viewBox'),
    svgDom,
  })
}

class LogoInstance {
  constructor(payload) {
    const { componentName, fileName, newFilePath, targetPath, extraBehavior, exist, width, height, viewBox, svgDom } =
      payload

    this.extraBehavior = extraBehavior ?? []
    this.newFilePath = newFilePath ?? ''
    this.componentName = componentName ?? ''
    this.fileName = fileName ?? ''
    this.targetPath = targetPath ?? ''
    this.exist = exist ?? false
    this.width = width ?? null
    this.height = height ?? null
    this.viewBox = viewBox ?? null
    this.svgDom = svgDom ?? null
  }
}
