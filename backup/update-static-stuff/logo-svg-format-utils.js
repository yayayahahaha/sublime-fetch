import path from 'path'
import fs from 'fs'
import { JSDOM } from 'jsdom'
import { consoleRed } from './utils.js'
import { high } from './console-utils.js'

const logoLightInfo = {
  fileName: 'logo-light.svg',
  componentName: 'LogoLight',
}
const logoDarkInfo = {
  fileName: 'logo-dark.svg',
  componentName: 'LogoDark',
}
const logos = [logoLightInfo, logoDarkInfo]

export async function syncLogoLightAndDark(logoInstanceList, { targetBrand, frontendRepoPath } = {}) {
  const infoList = logoInstanceList.map((logoInfo) => {
    const { svgDom } = logoInfo

    const domsHasId = svgDom.querySelectorAll('[id]')
    if (domsHasId.length === 0) {
      console.log(`${high(logoInfo.fileName)} 沒有需要調整的 id`)
      return new LogoInstance({
        ...logoInfo,
        content: svgDom.innerHTML,
        ids: [],
      })
    }

    console.log(`${high(logoInfo.fileName)} 有 ${high(domsHasId.length)} 個需要調整的 id`)

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
    const { content, componentName, width, height, ids, targetPath } = payload

    let templateContent = templateOriContent

    templateContent = templateContent.replace(/___REPLACE_ARIA_LABEL___/, `${targetBrand} Icon`)

    templateContent = templateContent.replace(/___REPLACE_SVG_CONTENT___/, content)

    templateContent = templateContent.replace(/___REPLACE_VUE_COMPONENT_NAME___/, componentName)

    templateContent = templateContent.replace(/___REPLACE_ICON_WIDTH___/, width)
    templateContent = templateContent.replace(/___REPLACE_ICON_HEIGHT___/, height)

    templateContent = templateContent.replace(
      /___REPLACE_UTILS_IMPORT___/,
      ids.length === 0 ? '' : `import { generateId } from '@/utils'`
    )

    templateContent = templateContent.replace(
      /___REPLACE_ID_LIST___/,
      ids.map((_, index) => `id${index + 1}: generateId(),\n`).join('')
    )

    return { formatVueContent: templateContent, targetPath }
  })

  vueContentInfo.forEach((item) => {
    const { formatVueContent, targetPath } = item
    fs.writeFileSync(targetPath, formatVueContent)
  })

  // TOOD(flyc): 調整 generalConfig
  const generalConfigPath = path.resolve(frontendRepoPath, 'src', `brand-${targetBrand}`, 'generalConfig.js')
  const matchedHeightRegexp = /const headerLogoHeight = '?(\d+)'?\n/
  let configContent = fs.readFileSync(generalConfigPath, 'utf8')
  const matchedHeight = configContent.match(matchedHeightRegexp)?.[1] ?? null
  if (matchedHeight != null) {
    configContent = configContent.replace(matchedHeightRegexp, function (match) {
      return match.replace(/(\d+)/, logoInstanceList[0].height ?? '$1')
    })
  }
  fs.writeFileSync(generalConfigPath, configContent)
}

export function checkLogoLightAndLogoDark(newImagesFolder, { frontendRepoPath, targetBrand } = {}) {
  if (typeof frontendRepoPath !== 'string') {
    consoleRed('缺少參數 frontendRepoPath')
    return []
  }
  if (typeof targetBrand !== 'string') {
    consoleRed('缺少參數 targetBrand')
    return []
  }

  const formatedLogoInfo = logos.reduce((acc, logoInfo) => {
    const logoPath = path.resolve('.', newImagesFolder, logoInfo.fileName)
    const exist = fs.existsSync(logoPath)
    if (!exist) {
      consoleRed(`${logoInfo.fileName} 不存在於 ${newImagesFolder} !`)
    }

    const targetPath = path.resolve(
      frontendRepoPath,
      'src',
      `brand-${targetBrand}`,
      'component',
      `${logoInfo.componentName}.vue`
    )
    const content = fs.readFileSync(logoPath, 'utf8')
    const svgDom = new JSDOM(content).window.document.querySelector('svg')
    if (svgDom == null) {
      consoleRed(`${logoPath} 不為 SVG!`)
    }

    const width = svgDom.getAttribute('width')
    const height = svgDom.getAttribute('height')

    acc.push(
      new LogoInstance({
        ...logoInfo,
        exist,
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
    const { componentName, fileName, targetPath, exist, width, height, svgDom, content, ids } = payload

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
