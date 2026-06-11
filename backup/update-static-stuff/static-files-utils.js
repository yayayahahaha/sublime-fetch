import select from '@inquirer/select'
import fs from 'fs'
import path from 'path'
import {
  checkSetting,
  consoleGreen,
  consolePathHint,
  consoleRed,
  consoleStep,
  ensureDir,
  getSize,
  high,
  isDir,
  readFilesRecursively,
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

function checkStaticImages(newImagesFolder, { frontendRepoPath, targetBrand } = {}) {
  const resourcePath = path.resolve('.', newImagesFolder, 'static')
  if (!isDir(resourcePath)) {
    consoleRed(`${resourcePath} 需為一個資料夾!`)
    return null
  }

  const newImagesList = readFilesRecursively(resourcePath)
  const newImagesMap = Object.fromEntries(
    newImagesList.map((filePath) => {
      const { base, ...others } = path.parse(filePath)
      return [base, { base, ...others, filePath }]
    })
  )

  return Promise.all(
    STATIC_IMAGES.map((neededImg) => {
      const newImageInfo = newImagesMap[neededImg.filename]
      const exist = newImageInfo != null

      if (!exist) {
        consoleRed(`${resourcePath} 裡缺少圖片 ${neededImg.filename}!`)
        return { ...neededImg, exist, passFormat: false }
      } else {
        // 檢查圖片的 ext 和 size
        return Promise.all([getSize(newImageInfo.filePath), { ...neededImg, newImageInfo, exist }]).then((res) => {
          const [newImgSizeInfo, otherInfo] = res

          const { size: requiredSizeInfo } = otherInfo
          const requiredSizeArray = Array.isArray(requiredSizeInfo) ? requiredSizeInfo : [requiredSizeInfo]
          const { width: nw, height: nh } = newImgSizeInfo

          const passFormat = (function () {
            return requiredSizeArray.some((requiredSizeInfo) => {
              if (requiredSizeInfo == null) return true
              if (typeof requiredSizeInfo === 'function') return requiredSizeInfo(nw, nh)
              const { width: rw, height: rh } = requiredSizeInfo
              return rw === nw && rh === nh
            })
          })()
          if (!passFormat) {
            const expectedDesc = requiredSizeArray
              .map((item) => (typeof item === 'function' ? '(自訂規則)' : `${item.width}x${item.height}`))
              .join(' 或 ')
            consoleRed(`${otherInfo.filename} 尺寸不符! 需為 ${expectedDesc}, 得到 ${nw}x${nh}`)
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
    ext: '.png',
    path: 'bundle/public/static/img',
  },
  {
    filename: 'manifest-icon-192.png',
    size: {
      width: 192,
      height: 192,
    },
    ext: '.png',
    path: 'bundle/public/static/img',
  },
  {
    filename: 'icon.svg',
    size: null,
    nameInFigma: 'Support-a',
    ext: '.svg',
    path: 'bundle/public/static/img',
  },
  {
    filename: 'icon-180.png',
    size: {
      width: 180,
      height: 180,
    },
    nameInFigma: 'Support-a',
    ext: '.png',
    path: 'bundle/public/static/img',
  },
  {
    filename: 'icon-150.png',
    size: {
      width: 150,
      height: 150,
    },
    nameInFigma: 'Support-a',
    ext: '.png',
    path: 'bundle/public/static/img',
  },
  {
    filename: 'icon-32.png',
    size: {
      width: 32,
      height: 32,
    },
    nameInFigma: 'Support-a',
    ext: '.png',
    path: 'bundle/public/static/img',
  },
  {
    filename: 'icon-16.png',
    size: {
      width: 16,
      height: 16,
    },
    nameInFigma: 'Support-a',
    ext: '.png',
    path: 'bundle/public/static/img',
  },
  {
    filename: 'apple-touch-icon.png',
    size: {
      width: 180,
      height: 180,
    },
    nameInFigma: 'Support-a',
    ext: '.png',
    path: 'bundle/public/static/img',
  },
  {
    filename: 'favicon.ico',
    size: function faviconSize(width, height) {
      return width === height
    },
    ext: '.ico',
    path: 'bundle/public',
  },
]
