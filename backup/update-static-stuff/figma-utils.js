import select from '@inquirer/select'
import fs from 'fs'
import path from 'path'
import terminalImage from 'terminal-image'
import {
  checkSetting,
  consoleGreen,
  consolePathHint,
  consoleRed,
  consoleStep,
  ensureDir,
  high,
  isDir,
  readFilesRecursively,
  readSetting,
} from './utils.js'

export async function figmaStuff() {
  const settings = readSetting()
  if (settings == null) return

  const { ok, newImagesFolder, figmaImagesFolders } = checkSetting(settings, [
    'new-images-folder',
    'figma-images-folders',
  ])
  if (!ok) return
  consoleStep('setting')

  const sourceDir = path.resolve('.', figmaImagesFolders)
  const targetDir = path.resolve('.', newImagesFolder, 'static')
  consolePathHint({
    sourceLines: [high(sourceDir)],
    targetLines: [high(targetDir)],
  })

  if (!isDir(newImagesFolder)) {
    return void consoleRed(`${newImagesFolder} 需為一個資料夾!`)
  }
  consoleStep(`${newImagesFolder} 為資料夾`)

  if (!isDir(figmaImagesFolders)) {
    return void consoleRed(`${figmaImagesFolders} 需為一個資料夾!`)
  }
  consoleStep(`${figmaImagesFolders} 為資料夾`)

  const hintImagePath = await terminalImage.file(path.resolve('.', 'hint-images', 'figma-images-place.png'), {
    width: '50%',
    height: '50%',
  })
  console.log('請從這個位置 export 以下 8 個 layers')
  console.log(hintImagePath)

  const checkNeededImages = checkFigmaImages({ figmaImagesFolders, newImagesFolder })
  if (checkNeededImages.some((img) => !img.passFormat)) {
    return void consoleRed('Figma 圖片檢查未通過，請修正以上問題後再執行')
  }
  consoleStep(`${checkNeededImages.length} 個 Figma 來源檔案存在`)

  const makeSure = await select({
    message: `檢查完畢，即將開始覆蓋當前 repo 底下指定的 ${newImagesFolder} 相關的檔案，確定嗎?`,
    choices: [
      {
        name: '等等等等等等等等等等',
        value: false,
      },
      {
        name: '清除完畢，開始吧',
        value: true,
      },
    ],
  }).catch(() => false)
  if (!makeSure) return

  ensureDir(targetDir)

  checkNeededImages.forEach((payload) => {
    const { figmaImgPath, newImgPath } = payload

    fs.copyFileSync(figmaImgPath, newImgPath)
  })

  consoleGreen(`共 ${checkNeededImages.length} 張圖片處理完畢!`)
}

function checkFigmaImages({ figmaImagesFolders, newImagesFolder } = {}) {
  const figmaImages = readFilesRecursively(path.resolve('.', figmaImagesFolders))
  const figmaImagesMap = Object.fromEntries(
    figmaImages.map((filePath) => {
      const { base, ...others } = path.parse(filePath)
      return [base, { base, ...others, filePath }]
    })
  )

  return FIGMA_IMAGES.map((neededImage) => {
    const figmaImage = figmaImagesMap[neededImage.filename]

    const exist = figmaImage != null

    if (!exist) {
      consoleRed(`${figmaImagesFolders} 裡缺少圖片 ${neededImage.filename}!`)
      return { ...neededImage, exist, passFormat: false }
    } else {
      const figmaImgPath = path.resolve('.', figmaImagesFolders, neededImage.filename)
      const newImgPath = path.resolve('.', newImagesFolder, 'static', neededImage.targetName)
      return { figmaImgPath, newImgPath, passFormat: true }
    }
  })
}

export const FIGMA_IMAGES = [
  { filename: 'support-logo-a.svg', targetName: 'icon.svg' },
  { filename: 'support-logo-a16.png', targetName: 'icon-16.png' },
  { filename: 'support-logo-a32.png', targetName: 'icon-32.png' },
  { filename: 'support-logo-a150.png', targetName: 'icon-150.png' },
  { filename: 'support-logo-a180.png', targetName: 'icon-180.png' },

  { filename: 'PWA_icon192.png', targetName: 'manifest-icon-192.png' },
  { filename: 'PWA_icon512.png', targetName: 'manifest-icon-512.png' },

  { filename: 'img-social-a.png', targetName: 'meta-image-og.png' },
  { filename: 'img-social-b.png', targetName: 'meta-image.png' },

  { filename: 'support-logo-a180.png', targetName: 'apple-touch-icon.png' },
  { filename: 'favicon.png', targetName: 'favicon.ico' },
]
