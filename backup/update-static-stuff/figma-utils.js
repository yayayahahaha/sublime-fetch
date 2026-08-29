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
  consoleYellow,
  ensureDir,
  high,
  isDir,
  readFilesMapByName,
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
  console.log('請從這個位置 export 需要的 layers (PWA / Favicon / Social, Support-a 這裡不會用到)')
  console.log(hintImagePath)
  consoleFigmaSourceHint()

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

export function checkFigmaImages({ figmaImagesFolders, newImagesFolder, figmaSourceMap = null } = {}) {
  const figmaImagesMap = figmaSourceMap ?? readFilesMapByName(path.resolve('.', figmaImagesFolders))

  return FIGMA_IMAGES.map((neededImage) => {
    const figmaImage = figmaImagesMap[neededImage.filename]

    const exist = figmaImage != null

    if (!exist) {
      consoleRed(`${figmaImagesFolders} 裡缺少圖片 ${neededImage.filename}!`)
      if (neededImage.note != null) {
        consoleYellow(`   ⚠️  ${neededImage.note}`)
      }
      return { ...neededImage, exist, passFormat: false }
    } else {
      // 用實際找到的路徑, 來源檔案放在子資料夾也能正確複製
      const figmaImgPath = figmaImage.filePath
      const newImgPath = path.resolve('.', newImagesFolder, 'static', neededImage.targetName)
      return { ...neededImage, exist, figmaImgPath, newImgPath, passFormat: true }
    }
  })
}

// Figma 上有兩套長得很像的 icon:
//   - PWA / Favicon: 有品牌底色的實心圖, 這裡要的就是這套
//   - Support-a / Support-b: 透明背景, 是給客服 (Freshdesk) 用的, 會另外上傳到 UI design 的 JIRA ticket
// 兩套的尺寸完全一樣, 拿錯不會被尺寸檢查攔下來, 只會多一個底色的 warning, 所以這張表別亂動
export const FIGMA_IMAGES = [
  // maskIcon, 來自 Figma 的 Favicon (有底色), 不是 Support-a
  { filename: 'favicon.svg', targetName: 'icon.svg' },
  {
    filename: 'favicon.ico',
    targetName: 'favicon.ico',
    note: '需為設計用 ICO exporter 轉好的 .ico (PRD 附件), 不能拿 favicon.png 改名',
  },

  // app icon 一律來自 Figma 的 PWA
  { filename: 'PWA_icon16.png', targetName: 'icon-16.png' },
  { filename: 'PWA_icon32.png', targetName: 'icon-32.png' },
  { filename: 'PWA_icon150.png', targetName: 'icon-150.png' },
  { filename: 'PWA_icon180.png', targetName: 'icon-180.png' },
  { filename: 'PWA_icon180.png', targetName: 'apple-touch-icon.png' },
  { filename: 'PWA_icon192.png', targetName: 'manifest-icon-192.png' },
  { filename: 'PWA_icon512.png', targetName: 'manifest-icon-512.png' },

  // meta / og 圖
  { filename: 'img-social-a.png', targetName: 'meta-image-og.png' },
  { filename: 'img-social-b.png', targetName: 'meta-image.png' },
]

// 去重後的來源檔名 (apple-touch-icon 和 icon-180 共用同一個來源)
export const FIGMA_SOURCE_FILE_NAMES = [...new Set(FIGMA_IMAGES.map((item) => item.filename))]

export function consoleFigmaSourceHint() {
  console.log(`需要的來源檔案共 ${high(FIGMA_SOURCE_FILE_NAMES.length)} 個:`)
  console.log(`   ${FIGMA_SOURCE_FILE_NAMES.map((name) => high(name)).join(', ')}`)
  FIGMA_IMAGES.filter((item) => item.note != null).forEach((item) => {
    consoleYellow(`   ⚠️  ${item.filename}: ${item.note}`)
  })
  console.log()
}
