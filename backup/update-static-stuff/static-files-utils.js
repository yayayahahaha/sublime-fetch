import select from '@inquirer/select'
import fs from 'fs'
import path from 'path'
import {
  checkSetting,
  consoleGreen,
  consolePathHint,
  consoleRed,
  consoleStep,
  consoleYellow,
  ensureDir,
  getSize,
  high,
  isDir,
  readFilesMapByName,
  readSetting,
} from './utils.js'
import { resolveBrand } from './brand-utils.js'

export async function staticStuff() {
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

  const sourceDir = path.resolve('.', newImagesFolder, 'static')
  const targetDir = path.resolve(frontendRepoPath, 'src', `brand-${targetBrand}`, 'bundle/public/static/img')
  consolePathHint({
    sourceLines: [high(sourceDir)],
    targetLines: [high(targetDir), `${high(path.resolve(frontendRepoPath, 'src', `brand-${targetBrand}`, 'bundle/public'))} (favicon.ico)`],
  })

  if (!isDir(newImagesFolder)) {
    return void consoleRed(`${newImagesFolder} 需為一個資料夾!`)
  }
  consoleStep(`${newImagesFolder} 為資料夾`)

  const checkNeededImages = await checkStaticImages(newImagesFolder, {
    frontendRepoPath,
    targetBrand,
  })
  if (checkNeededImages == null) return
  if (checkNeededImages.some((img) => !img.passFormat)) {
    return void consoleRed('static 圖片檢查未通過，請修正以上問題後再執行')
  }
  consoleStep(`${checkNeededImages.length} 張圖片存在與尺寸`)

  const makeSure = await select({
    message: '檢查完畢，即將開始覆蓋 static 相關的檔案，請確認清空 frontend repo 的 git status',
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

  checkNeededImages.forEach((payload) => {
    const {
      newImageInfo: { filePath: newImgPath },
      targetPath,
    } = payload

    ensureDir(path.dirname(targetPath))
    fs.copyFileSync(newImgPath, targetPath)
  })

  consoleGreen(`共 ${checkNeededImages.length} 張圖片處理完畢!`)
}

// { 目標檔名: 來源路徑 } 轉成和 readFilesMapByName 相同結構的 map
function toSourceFilesMap(sourceFiles) {
  const entries = Object.entries(sourceFiles).map(([filename, filePath]) => {
    return [filename, { ...path.parse(filePath), base: filename, filePath }]
  })
  return Object.fromEntries(entries)
}

/**
 * @param {object} options
 * @param {Record<string, string>} [options.sourceFiles] 以「目標檔名」為 key、來源絕對路徑為 value 的 map,
 *                                                       傳入時就直接檢查這些檔案, 不會去讀 new-images/static
 */
export function checkStaticImages(newImagesFolder, { frontendRepoPath, targetBrand, sourceFiles = null } = {}) {
  const resourcePath = path.resolve('.', newImagesFolder, 'static')
  if (sourceFiles == null && !isDir(resourcePath)) {
    consoleRed(`${resourcePath} 需為一個資料夾!`)
    return null
  }

  const newImagesMap = sourceFiles == null ? readFilesMapByName(resourcePath) : toSourceFilesMap(sourceFiles)

  return Promise.all(
    STATIC_IMAGES.map((neededImg) => {
      const newImageInfo = newImagesMap[neededImg.filename]
      const exist = newImageInfo != null

      if (!exist) {
        consoleRed(`${sourceFiles == null ? resourcePath : '來源'} 裡缺少圖片 ${neededImg.filename}!`)
        return { ...neededImg, exist, passFormat: false }
      }

      return checkOneStaticImage({ ...neededImg, newImageInfo, exist }, { frontendRepoPath, targetBrand })
    })
  )
}

// 檢查單張圖片的 size / 檔案格式, 並在底色看起來不對的時候提醒 (提醒不影響 passFormat)
async function checkOneStaticImage(info, { frontendRepoPath, targetBrand } = {}) {
  const { filename, size: requiredSizeInfo, requiredType = null, opaqueBackground = false, newImageInfo } = info
  const newImgSizeInfo = await getSize(newImageInfo.filePath)
  const { width: nw, height: nh, type: nType } = newImgSizeInfo

  const requiredSizeArray = Array.isArray(requiredSizeInfo) ? requiredSizeInfo : [requiredSizeInfo]
  const passSize = requiredSizeArray.some((requiredSize) => {
    if (requiredSize == null) return true
    if (typeof requiredSize === 'function') return requiredSize(nw, nh)
    return requiredSize.width === nw && requiredSize.height === nh
  })
  if (!passSize) {
    const expectedDesc = requiredSizeArray
      .map((item) => (typeof item === 'function' ? '(自訂規則)' : `${item.width}x${item.height}`))
      .join(' 或 ')
    consoleRed(`${filename} 尺寸不符! 需為 ${expectedDesc}, 得到 ${nw}x${nh}`)
  }

  const passType = requiredType == null || nType === requiredType
  if (!passType) {
    consoleRed(`${filename} 檔案格式不符! 需為真正的 ${requiredType} 檔, 實際內容是 ${nType}`)
  }

  if (opaqueBackground) {
    await warnIfNoOpaqueBackground(filename, newImageInfo.filePath)
  }

  const targetPath = path.resolve(frontendRepoPath, 'src', `brand-${targetBrand}`, info.path, filename)

  return { ...info, targetPath, passFormat: passSize && passType, newImgSizeInfo }
}

// app icon 應該是 Figma 的 PWA / Favicon (有品牌底色), 透明背景通常代表拿到 Support-a 那套了
async function warnIfNoOpaqueBackground(filename, filePath) {
  const wrongVersionHint = `確認一下是不是拿到 Support 版而不是 PWA / Favicon 版?`

  if (path.extname(filePath).toLowerCase() === '.svg') {
    const content = fs.readFileSync(filePath, 'utf8')
    if (!/<rect[^>]*\sfill=/i.test(content)) {
      consoleYellow(`⚠️  ${filename} 找不到底色 (沒有 <rect fill>), ${wrongVersionHint}`)
    }
    return
  }

  try {
    // jimp 比較重, 只有真的要檢查底色時才載入
    const { Jimp } = await import('jimp')
    const image = await Jimp.read(filePath)
    const alpha = image.getPixelColor(0, 0) & 0xff
    if (alpha === 0) {
      consoleYellow(`⚠️  ${filename} 左上角是透明的, ${wrongVersionHint}`)
    }
  } catch {
    // 讀不出來就跳過, 這只是提醒而不是檢查
  }
}

export const STATIC_IMAGES = [
  {
    filename: 'meta-image-og.png',
    size: {
      width: 400,
      height: 400,
    },
    nameInFigma: 'Social-a',
    ext: '.png',
    path: 'bundle/public/static/img',
  },
  {
    filename: 'meta-image.png',
    size: {
      width: 1200,
      height: 675,
    },
    nameInFigma: 'Social-b',
    ext: '.png',
    path: 'bundle/public/static/img',
  },
  {
    filename: 'manifest-icon-512.png',
    size: {
      width: 512,
      height: 512,
    },
    nameInFigma: 'PWA',
    ext: '.png',
    path: 'bundle/public/static/img',
    opaqueBackground: true,
  },
  {
    filename: 'manifest-icon-192.png',
    size: {
      width: 192,
      height: 192,
    },
    nameInFigma: 'PWA',
    ext: '.png',
    path: 'bundle/public/static/img',
    opaqueBackground: true,
  },
  {
    filename: 'icon.svg',
    size: null,
    nameInFigma: 'Favicon',
    ext: '.svg',
    path: 'bundle/public/static/img',
    opaqueBackground: true,
  },
  {
    filename: 'icon-180.png',
    size: {
      width: 180,
      height: 180,
    },
    nameInFigma: 'PWA',
    ext: '.png',
    path: 'bundle/public/static/img',
    opaqueBackground: true,
  },
  {
    filename: 'icon-150.png',
    size: {
      width: 150,
      height: 150,
    },
    nameInFigma: 'PWA',
    ext: '.png',
    path: 'bundle/public/static/img',
    opaqueBackground: true,
  },
  {
    filename: 'icon-32.png',
    size: {
      width: 32,
      height: 32,
    },
    nameInFigma: 'PWA',
    ext: '.png',
    path: 'bundle/public/static/img',
    opaqueBackground: true,
  },
  {
    filename: 'icon-16.png',
    size: {
      width: 16,
      height: 16,
    },
    nameInFigma: 'PWA',
    ext: '.png',
    path: 'bundle/public/static/img',
    opaqueBackground: true,
  },
  {
    filename: 'apple-touch-icon.png',
    size: {
      width: 180,
      height: 180,
    },
    nameInFigma: 'PWA',
    ext: '.png',
    path: 'bundle/public/static/img',
    opaqueBackground: true,
  },
  {
    // 各 brand 的 ico 實際尺寸不一 (48 / 64 / 256 都有), 真 ICO 本身就能打包多尺寸, 所以只要求正方形
    // 但一定要是真的 ICO, 不能拿 png 改名 (設計會用 ICO exporter 轉好放在 PRD 附件)
    filename: 'favicon.ico',
    size: function faviconSize(width, height) {
      return width === height
    },
    requiredType: 'ico',
    nameInFigma: 'Favicon (需用 ICO exporter 轉檔 / PRD 附件)',
    ext: '.ico',
    path: 'bundle/public',
  },
]
