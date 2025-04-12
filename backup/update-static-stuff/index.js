import fs from 'fs'
import select from '@inquirer/select'

import { checkStaticImages, checkSetting, consoleRed, isDir, readSetting } from './utils.js'
import { 修改白牌會動到的東西 } from './console-utils.js'
import { checkLogoLightAndLogoDark, syncLogoLightAndDark } from './logo-svg-format-utils.js'

修改白牌會動到的東西()
start()

async function start() {
  console.log()

  const 現在要做啥 = await select({
    message: '選擇想要做的事情: ',
    choices: [
      {
        name: '同步 LogoLight 和 LogoDark',
        value: 'SvgLogo',
      },
      {
        name: '同步 static 相關的靜態檔案',
        value: 'static',
      },
    ],
  })

  switch (現在要做啥) {
    case 'static':
      return staticStuff()

    case 'SvgLogo':
      return svgLogoStuff()
  }
}

async function svgLogoStuff() {
  const settings = readSetting()
  if (settings == null) return

  const { ok, frontendRepoPath, newImagesFolder, targetBrand } = checkSetting(settings)
  if (!ok) return

  if (!isDir(newImagesFolder)) {
    return void consoleRed('new-images-folder 需為一個資料夾!')
  }

  const logoInstanceList = checkLogoLightAndLogoDark(newImagesFolder, {
    frontendRepoPath,
    targetBrand,
  })
  if (logoInstanceList.length === 0) return

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

  console.log('完成!')
}

async function staticStuff() {
  const settings = readSetting()
  if (settings == null) return

  const { ok, frontendRepoPath, newImagesFolder, targetBrand } = checkSetting(settings)
  if (!ok) return

  if (!isDir(newImagesFolder)) {
    return void consoleRed('new-images-folder 需為一個資料夾!')
  }

  const checkNeededImages = await checkStaticImages(newImagesFolder, {
    frontendRepoPath,
    targetBrand,
  })
  if (checkNeededImages.some((img) => !img.passFormat)) return

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

    fs.copyFileSync(newImgPath, targetPath)
  })

  console.log(`\x1b[32m共 ${checkNeededImages.length} 張圖片處理完畢!\x1b[0m`)
}
