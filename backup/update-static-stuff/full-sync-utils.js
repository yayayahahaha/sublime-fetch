import path from 'path'
import select from '@inquirer/select'
import {
  checkSetting,
  consoleGreen,
  consolePathHint,
  consoleRed,
  consoleStep,
  copyFileEnsureDir,
  ensureDir,
  high,
  isDir,
  readFilesMapByName,
  readSetting,
} from './utils.js'
import { resolveBrand } from './brand-utils.js'
import { checkFigmaImages, consoleFigmaSourceHint } from './figma-utils.js'
import { checkStaticImages } from './static-files-utils.js'
import {
  APP_ICON_SOURCE_FILE_NAME,
  LOGO_SOURCE_FILE_NAMES,
  checkAppIcon,
  checkLogoLightAndLogoDark,
  checkMaintenanceLogo,
  checkS3Logos,
  syncAppIcon,
  syncLogoLightAndDark,
  syncMaintenanceLogo,
} from './logo-svg-format-utils.js'

// 產生 vue 元件 / s3 圖片所需的來源檔案, 全部都是必要的
const COMPONENT_SOURCE_FILE_NAMES = [...LOGO_SOURCE_FILE_NAMES, APP_ICON_SOURCE_FILE_NAME]

export async function fullSyncFromFigma() {
  const settings = readSetting()
  if (settings == null) return

  const {
    ok,
    frontendRepoPath,
    s3RepoPath,
    newImagesFolder,
    figmaImagesFolders,
    targetBrand: settingBrand,
  } = checkSetting(settings, [
    'frontend-repo-path',
    's3-repo-path',
    'new-images-folder',
    'figma-images-folders',
    'target-brand',
  ])
  if (!ok) return
  consoleStep('setting')

  const targetBrand = await resolveBrand({ settingBrand, frontendRepoPath, s3RepoPath })
  if (targetBrand == null) return
  consoleStep(`target-brand = ${high(targetBrand)}`)

  if (!isDir(figmaImagesFolders)) {
    return void consoleRed(`${figmaImagesFolders} 需為一個資料夾!`)
  }
  consoleStep(`${figmaImagesFolders} 為資料夾`)

  consolePathHint({
    sourceLines: [high(path.resolve('.', figmaImagesFolders))],
    targetLines: [
      high(path.resolve(frontendRepoPath, 'src', `brand-${targetBrand}`)),
      high(path.resolve(s3RepoPath, targetBrand)),
      `${high(path.resolve('.', newImagesFolder))} (來源檔案的暫存)`,
    ],
  })

  consoleFigmaSourceHint()
  console.log(`元件 (Logo / AppIcon) 來源檔案共 ${high(COMPONENT_SOURCE_FILE_NAMES.length)} 個:`)
  console.log(`   ${COMPONENT_SOURCE_FILE_NAMES.map((name) => high(name)).join(', ')}`)
  console.log()

  consoleStep('檢查 Figma 來源檔案是否齊全')

  // static 和 logo 共用同一份遞迴掃描的結果, 兩者的尋找方式才會一致
  const figmaSourceMap = readFilesMapByName(path.resolve('.', figmaImagesFolders))
  const staticSourceChecks = checkFigmaImages({ figmaImagesFolders, newImagesFolder, figmaSourceMap })
  const logoSourceChecks = checkLogoSources({ figmaImagesFolders, figmaSourceMap })

  const staticSourceOk = staticSourceChecks.every((img) => img.passFormat)
  const logoSourceOk = logoSourceChecks.every((img) => img.exist)
  if (!staticSourceOk || !logoSourceOk) {
    return void consoleRed('Figma 來源檔案檢查未通過，請修正以上問題後再執行')
  }
  consoleStep(`${staticSourceChecks.length + logoSourceChecks.length} 個 Figma 來源檔案存在`)

  // 直接對 figma-images 裡的來源檔案做檢查, 確認之前不寫入任何東西
  const staticSourceFiles = Object.fromEntries(
    staticSourceChecks.map(({ targetName, figmaImgPath }) => [targetName, figmaImgPath])
  )
  const logoSourceFiles = Object.fromEntries(logoSourceChecks.map(({ filename, filePath }) => [filename, filePath]))

  const staticImageChecks = await checkStaticImages(newImagesFolder, {
    frontendRepoPath,
    targetBrand,
    sourceFiles: staticSourceFiles,
  })
  const logoInstanceList = checkLogoLightAndLogoDark(newImagesFolder, {
    frontendRepoPath,
    targetBrand,
    sourceFiles: logoSourceFiles,
  })
  const s3LogoInstanceList = checkS3Logos(newImagesFolder, {
    s3RepoPath,
    targetBrand,
    sourceFiles: logoSourceFiles,
  })
  const appIconInstance = checkAppIcon(newImagesFolder, {
    frontendRepoPath,
    targetBrand,
    sourceFiles: logoSourceFiles,
  })
  const maintenanceLogo = checkMaintenanceLogo(newImagesFolder, {
    frontendRepoPath,
    targetBrand,
    sourceFiles: logoSourceFiles,
  })

  const staticImageOk = staticImageChecks != null && staticImageChecks.every((img) => img.passFormat)
  const logoOk = logoInstanceList.length > 0
  const s3LogoOk = s3LogoInstanceList.length > 0
  const appIconOk = appIconInstance.exist
  const maintenanceLogoOk = maintenanceLogo == null || maintenanceLogo.exist
  if (!staticImageOk || !logoOk || !s3LogoOk || !appIconOk || !maintenanceLogoOk) {
    return void consoleRed('格式 / 尺寸檢查未通過，請修正以上問題後再執行')
  }
  consoleStep('格式 / 尺寸檢查全數通過')

  const makeSure = await select({
    message: `檢查完畢，即將一次覆蓋 frontend 的 static 圖片、Logo 元件，以及 s3 repo 的 Logo，請確認清空 frontend / s3 repo 的 git status，確定嗎?`,
    choices: [
      { name: '等等等等等等等等等等', value: false },
      { name: '清除完畢，開始吧', value: true },
    ],
  }).catch(() => false)
  if (!makeSure) return

  copySourcesToStaging({ staticSourceChecks, logoSourceChecks, newImagesFolder })
  consoleStep('已將來源檔案整理到 new-images 資料夾')

  staticImageChecks.forEach((payload) => {
    const {
      newImageInfo: { filePath: newImgPath },
      targetPath,
    } = payload
    copyFileEnsureDir(newImgPath, targetPath)
  })
  consoleGreen(`共 ${staticImageChecks.length} 張 static 圖片處理完畢!`)

  await syncLogoLightAndDark(logoInstanceList, { targetBrand, frontendRepoPath })
  consoleGreen(`共 ${logoInstanceList.length} 個 Logo 元件處理完畢!`)

  syncAppIcon(appIconInstance)
  consoleGreen('AppIcon.vue 處理完畢!')

  syncMaintenanceLogo(maintenanceLogo)
  if (maintenanceLogo != null) consoleGreen(`維護頁的 ${maintenanceLogo.targetFileName} 處理完畢!`)

  s3LogoInstanceList.forEach((payload) => {
    payload.extraBehavior.forEach((behavior) => behavior())
  })
  consoleGreen(`共 ${s3LogoInstanceList.length} 個 Logo 同步到 s3 repo 完畢!`)

  consoleGreen('全部完成!')
}

function checkLogoSources({ figmaImagesFolders, figmaSourceMap }) {
  return COMPONENT_SOURCE_FILE_NAMES.map((filename) => {
    const figmaImage = figmaSourceMap[filename] ?? null
    if (figmaImage == null) {
      consoleRed(`${figmaImagesFolders} 裡缺少元件的來源檔案 ${filename}!`)
      return { filename, filePath: null, exist: false }
    }
    return { filename, filePath: figmaImage.filePath, exist: true }
  })
}

function copySourcesToStaging({ staticSourceChecks, logoSourceChecks, newImagesFolder }) {
  ensureDir(path.resolve('.', newImagesFolder))

  staticSourceChecks.forEach(({ figmaImgPath, newImgPath }) => {
    copyFileEnsureDir(figmaImgPath, newImgPath)
  })

  const logoTargetDir = path.resolve('.', newImagesFolder, 'logos')
  logoSourceChecks.forEach(({ filename, filePath }) => {
    copyFileEnsureDir(filePath, path.resolve(logoTargetDir, filename))
  })
}
