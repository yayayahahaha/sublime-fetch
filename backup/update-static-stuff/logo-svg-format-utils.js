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
    sourceLines: [`${high(sourceDir)}`, `${high('logo-light.svg')}, ${high('logo-dark.svg')}`],
    targetLines: [`${high(targetDir)}`, `${high('LogoLight.vue')}, ${high('LogoDark.vue')}`],
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

  const makeSure = await select({
    message: '檢查完畢，即將開始修改 LogoLight 和 LogoDark 相關的檔案，請確認清空 frontend repo 的 git status',
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

  const logoInstanceList = _checkS3Logos(newImagesFolder, {
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

  function _checkS3Logos(newImagesFolder, { s3RepoPath, targetBrand } = {}) {
    const formatedLogoInfo = logos.reduce((acc, logoInfo) => {
      const logoPath = path.resolve('.', newImagesFolder, 'logos', logoInfo.pngFileName)
      const logoPathSvg = path.resolve('.', newImagesFolder, 'logos', logoInfo.fileName)
      const exist = fs.existsSync(logoPath)
      const existSvg = fs.existsSync(logoPathSvg)
      if (!exist) {
        consoleRed(`${logoInfo.pngFileName} 不存在於 ${path.resolve(newImagesFolder, 'logos')} !`)
      }
      if (!existSvg) {
        consoleRed(`${logoInfo.fileName} 不存在於 ${path.resolve(newImagesFolder, 'logos')} !`)
      }

      const newFilePath = logoPath
      const newFilePathSvg = logoPathSvg
      const targetPath = path.resolve(s3RepoPath, targetBrand, logoInfo.pngFileName)
      const targetPathSvg = path.resolve(s3RepoPath, targetBrand, logoInfo.fileName)
      const targetPathEmail = path.resolve(s3RepoPath, targetBrand, 'email', logoInfo.pngFileName)

      ensureDir(path.parse(targetPath).dir)
      ensureDir(path.parse(targetPathSvg).dir)
      ensureDir(path.parse(targetPathEmail).dir)

      const extraBehavior = [
        () => fs.copyFileSync(newFilePath, targetPath),
        () => fs.copyFileSync(newFilePath, targetPathEmail),
        () => fs.copyFileSync(newFilePathSvg, targetPathSvg),
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
}

export function svgToVue() {
  const svgFolder = 'svg-to-vue-images'
  const resultFolder = 'svg-to-vue-images-result'

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

    const vueStr = svgStrIntoVueStr(content, { filename })
    const parseInfo = path.parse(path.resolve(resultFolder, filename))
    const resultPath = `${path.resolve(parseInfo.dir, parseInfo.name)}.vue`
    fs.writeFileSync(resultPath, vueStr)
    consoleGreen(`${resultPath} 創建完成`)
  })
}

function svgStrIntoVueStr(svgStr, { filename = null, verbose = true } = {}) {
  const svgDom = new JSDOM(svgStr)?.window?.document.querySelector('svg') ?? null
  if (svgDom == null) throw new Error(`[svgStrIntoVueStr] svgStr is not a svg format`)

  const domsHasId = svgDom.querySelectorAll('[id]')
  if (verbose) {
    console.log(`${filename == null ? '' : `${high(filename)} `}有 ${high(domsHasId.length)} 個需要調整的 id`)
  }

  const ids = []
  domsHasId.forEach((element, index) => {
    const id = element.id
    const num = index + 1
    element.setAttribute(':id', `id${num}`)
    element.removeAttribute('id')

    ids.push(id)
  })

  svgDom.querySelectorAll('*').forEach((element) => {
    const attributes = element.getAttributeNames()
    attributes.forEach((attrName) => {
      const attrValue = element.getAttribute(attrName)

      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]
        const regexp = new RegExp(`url\\(\\#${id}\\)`)
        if (attrValue.match(regexp) != null) {
          element.setAttribute(`:${attrName}`, `\`url(#\${id${i + 1}})\``)
          element.removeAttribute(attrName)
        }
      }
    })
  })

  const content = svgDom.innerHTML
  const width = svgDom.getAttribute('width') ?? null
  const height = svgDom.getAttribute('height') ?? null

  let templateContent = fs.readFileSync(path.resolve('.', 'VUE_ICON_TEMPLATE.txt'), 'utf8')

  templateContent = templateContent.replace(/___REPLACE_ARIA_LABEL___/, `icon-${path.parse(filename).name}`)

  templateContent = templateContent.replace(/___REPLACE_SVG_CONTENT___/, content)

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

async function syncLogoLightAndDark(logoInstanceList, { targetBrand, frontendRepoPath } = {}) {
  const infoList = logoInstanceList.map((logoInfo) => {
    const { svgDom } = logoInfo

    const domsHasId = svgDom.querySelectorAll('[id]')
    if (domsHasId.length === 0) {
      consoleGreen(`${logoInfo.fileName} 沒有需要調整的 id`)
      return new LogoInstance({
        ...logoInfo,
        content: svgDom.innerHTML,
        ids: [],
      })
    }

    consoleGreen(`${logoInfo.fileName} 有 ${domsHasId.length} 個需要調整的 id`)

    const ids = []
    domsHasId.forEach((element, index) => {
      const id = element.id
      const num = index + 1
      element.setAttribute(':id', `id${num}`)
      element.removeAttribute('id')

      ids.push(id)
    })

    svgDom.querySelectorAll('*').forEach((element) => {
      const attributes = element.getAttributeNames()
      attributes.forEach((attrName) => {
        const attrValue = element.getAttribute(attrName)

        for (let i = 0; i < ids.length; i++) {
          const id = ids[i]
          const regexp = new RegExp(`url\\(\\#${id}\\)`)
          if (attrValue.match(regexp) != null) {
            element.setAttribute(`:${attrName}`, `\`url(#\${id${i + 1}})\``)
            element.removeAttribute(attrName)
          }
        }
      })
    })

    return new LogoInstance({ ...logoInfo, ids, content: svgDom.innerHTML })
  })

  const templateOriContent = fs.readFileSync(path.resolve('.', 'LOGO_TEMPLATE.txt'), 'utf8')
  const vueContentInfo = infoList.map((payload) => {
    const { content, width, height, ids, targetPath } = payload

    let templateContent = templateOriContent

    templateContent = templateContent.replace(/___REPLACE_ARIA_LABEL___/, `${targetBrand} Icon`)

    templateContent = templateContent.replace(/___REPLACE_SVG_CONTENT___/, content)

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

    return { formatVueContent: templateContent, targetPath }
  })

  vueContentInfo.forEach((item) => {
    const { formatVueContent, targetPath } = item
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

function checkLogoLightAndLogoDark(newImagesFolder, { frontendRepoPath, targetBrand } = {}) {
  const formatedLogoInfo = logos.reduce((acc, logoInfo) => {
    const logoPath = path.resolve('.', newImagesFolder, 'logos', logoInfo.fileName)
    const exist = fs.existsSync(logoPath)
    if (!exist) {
      consoleRed(`${logoInfo.fileName} 不存在於 ${path.resolve(newImagesFolder, 'logos')} !`)
    }

    const targetPath = path.resolve(
      frontendRepoPath,
      'src',
      `brand-${targetBrand}`,
      'component',
      `${logoInfo.componentName}.vue`
    )
    const content = exist ? fs.readFileSync(logoPath, 'utf8') : ''
    const svgDom = exist ? new JSDOM(content).window.document.querySelector('svg') : null
    if (exist && svgDom == null) {
      consoleRed(`${logoPath} 不為 SVG!`)
    }

    const valid = exist && svgDom != null
    const width = valid ? svgDom.getAttribute('width') : null
    const height = valid ? svgDom.getAttribute('height') : null

    acc.push(
      new LogoInstance({
        ...logoInfo,
        exist: valid,
        targetPath,
        width,
        height,
        svgDom,
      })
    )

    return acc
  }, [])

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

class LogoInstance {
  constructor(payload) {
    const {
      componentName,
      fileName,
      newFilePath,
      targetPath,
      extraBehavior,
      exist,
      width,
      height,
      svgDom,
      content,
      ids,
    } = payload

    this.extraBehavior = extraBehavior ?? []
    this.newFilePath = newFilePath ?? ''
    this.componentName = componentName ?? ''
    this.fileName = fileName ?? ''
    this.targetPath = targetPath ?? ''
    this.exist = exist ?? false
    this.width = width ?? null
    this.height = height ?? null
    this.svgDom = svgDom ?? null
    this.content = content ?? ''
    this.ids = ids ?? []
  }
}
