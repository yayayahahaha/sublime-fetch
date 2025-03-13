import path from 'path'
import fs from 'fs'
import { imageSizeFromFile } from 'image-size/fromFile'

const SETTING_FILE_NAME = 'setting.json'
const SETTING_FILE_PATH = path.resolve('./', SETTING_FILE_NAME)

export function getSize(path) {
  return imageSizeFromFile(path)
}

export function readFilesRecursively(pathStr, list = []) {
  fs.readdirSync(pathStr).forEach(name => {
    const fullPath = path.join(pathStr, name)
    isDir(fullPath) ? readFilesRecursively(fullPath, list) : list.push(fullPath)
  })
  return list
}
export function isDir(path) {
  if (!fs.existsSync(path)) return false
  return fs.lstatSync(path).isDirectory()
}

export function checkSetting(setting) {
  let {
    'frontend-repo-path': frontendRepoPath,
    'new-images-folder': newImagesFolder,
    'target-brand': targetBrand
  } = setting

  let ok = true

  if (typeof frontendRepoPath !== 'string') {
    consoleRed('frontendRepoPath 需為 string!')
    frontendRepoPath = null
    ok = false
  } else if (frontendRepoPath.match(/\//) == null) {
    consoleRed('frontendRepoPath 需為絕對路徑!')
    frontendRepoPath = null
    ok = false
  }

  if (typeof newImagesFolder !== 'string') {
    consoleRed('newImagesFolder 需為 string!')
    newImagesFolder = null
    ok = false
  } else if (newImagesFolder.match(/^\./) == null) {
    consoleRed('newImagesFolder 需為相對路徑!')
    newImagesFolder = null
    ok = false
  }

  if (typeof targetBrand !== 'string') {
    consoleRed('targetBrand 需為 string!')
    targetBrand = null
    ok = false
  } else if (frontendRepoPath != null) {
    const brandPath = path.resolve(
      frontendRepoPath,
      'src',
      `brand-${targetBrand}`
    )
    if (!fs.existsSync(brandPath)) {
      consoleRed(
        `targetBrand "${targetBrand}" 不存在於 ${frontendRepoPath}/src/brand-${targetBrand}!`
      )
      targetBrand = null
      ok = false
    }
  }

  return { ok, frontendRepoPath, newImagesFolder, targetBrand }
}

export function checkStaticImages(
  newImagesFolder,
  { frontendRepoPath, targetBrand } = {}
) {
  if (typeof frontendRepoPath !== 'string') {
    consoleRed('缺少參數 frontendRepoPath')
    return []
  }
  if (typeof targetBrand !== 'string') {
    consoleRed('缺少參數 targetBrand')
    return []
  }

  const newImagesList = readFilesRecursively(path.resolve('.', newImagesFolder))
  const newImagesMap = Object.fromEntries(
    newImagesList.map(filePath => {
      const { base, ...others } = path.parse(filePath)
      return [base, { base, ...others, filePath }]
    })
  )

  return Promise.all(
    STATIC_IMAGES.map(neededImg => {
      const newImageInfo = newImagesMap[neededImg.filename]
      const exist = newImageInfo != null

      if (!exist) {
        consoleRed(`newImagesFolder 裡缺少圖片 ${neededImg.filename}!`)
        return { ...neededImg, exist, passFormat: false }
      } else {
        // 檢查圖片的 ext 和 size
        return Promise.all([
          getSize(newImageInfo.filePath),
          { ...neededImg, newImageInfo, exist }
        ]).then(res => {
          const [newImgSizeInfo, otherInfo] = res

          const { size: requiredSizeInfo, ext } = otherInfo
          const { width: rw, height: rh } = requiredSizeInfo ?? {}
          const { width: nw, height: nh } = newImgSizeInfo

          const passFormat = (rw === nw && rh === nh) || ext === '.svg'
          if (!passFormat) {
            console.log(otherInfo)
            consoleRed(
              `${otherInfo.filename} 尺寸不符! 需為 ${rw}x${rh}, 得到 ${nw}x${nh}`
            )
          }

          const targetPath = path.resolve(
            frontendRepoPath,
            'src',
            `brand-${targetBrand}`,
            otherInfo.path,
            otherInfo.filename
          )

          return { ...otherInfo, targetPath, passFormat, newImgSizeInfo }
        })
      }
    })
  )
}

export function consoleRed(message) {
  console.log(`\x1b[31m${message}\x1b[0m`)
}

export function readSetting() {
  try {
    const content = fs.readFileSync(SETTING_FILE_PATH, 'utf8')
    return parseJson(content)
  } catch (e) {
    consoleRed('readSetting: 讀取 setting.json 失敗!')
    console.log(e)
    return null
  }
}

export function parseJson(jsonStr) {
  try {
    return JSON.parse(jsonStr)
  } catch {
    consoleRed('parseJson: JSON.parse 失敗!')
    return null
  }
}

export const STATIC_IMAGES = [
  {
    filename: 'meta-image.png',
    size: {
      width: 400,
      height: 400
    },
    nameInFigma: 'Social-a',
    ext: '.png',
    path: 'bundle/public/static/img'
  },
  {
    filename: 'meta-image-og.png',
    size: {
      width: 1200,
      height: 675
    },
    nameInFigma: 'Social-b',
    ext: '.png',
    path: 'bundle/public/static/img'
  },
  {
    filename: 'manifest-icon-512.png',
    size: {
      width: 512,
      height: 512
    },
    ext: '.png',
    path: 'bundle/public/static/img'
  },
  {
    filename: 'manifest-icon-192.png',
    size: {
      width: 192,
      height: 192
    },
    ext: '.png',
    path: 'bundle/public/static/img'
  },
  {
    filename: 'icon.svg',
    size: null,
    nameInFigma: 'Support-a',
    ext: '.svg',
    path: 'bundle/public/static/img'
  },
  {
    filename: 'icon-180.png',
    size: {
      width: 180,
      height: 180
    },
    nameInFigma: 'Support-a',
    ext: '.png',
    path: 'bundle/public/static/img'
  },
  {
    filename: 'icon-150.png',
    size: {
      width: 150,
      height: 150
    },
    nameInFigma: 'Support-a',
    ext: '.png',
    path: 'bundle/public/static/img'
  },
  {
    filename: 'icon-32.png',
    size: {
      width: 32,
      height: 32
    },
    nameInFigma: 'Support-a',
    ext: '.png',
    path: 'bundle/public/static/img'
  },
  {
    filename: 'icon-16.png',
    size: {
      width: 16,
      height: 16
    },
    nameInFigma: 'Support-a',
    ext: '.png',
    path: 'bundle/public/static/img'
  },
  {
    filename: 'apple-touch-icon.png',
    size: {
      width: 180,
      height: 180
    },
    ext: '.png',
    path: 'bundle/public/static/img'
  },
  {
    filename: 'favicon.ico',
    size: {
      width: 48,
      height: 48
    },
    ext: '.png',
    path: 'bundle/public'
  }
]

// 這個不一定有
export const ASSETS_IMAGES = [
  {
    filename: 'rocket.png',
    size: {
      width: 342,
      height: 232
    },
    nameInFigma: 'icon & assets 底下',
    ext: '.png',
    path: 'assets'
  },
  {
    filename: 'earth.png',
    size: {
      width: 342,
      height: 232
    },
    nameInFigma: 'icon & assets 底下',
    ext: '.png',
    path: 'assets'
  },
  {
    filename: 'coins.png',
    size: {
      width: 342,
      height: 232
    },
    nameInFigma: 'icon & assets 底下',
    ext: '.png',
    path: 'assets'
  }
]
