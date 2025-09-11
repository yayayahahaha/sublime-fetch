import select from '@inquirer/select'
import checkbox from '@inquirer/checkbox'
import fs from 'fs'
import path from 'path'
import terminalImage from 'terminal-image'
import { checkSetting, consoleRed, getSize, isDir, readFilesRecursively, readSetting } from './utils.js'

const exampleImagesFolderPath = path.resolve('.', 'assets-default-images')

export async function assetsStuff() {
  const settings = readSetting()
  if (settings == null) return

  const { ok, frontendRepoPath, newImagesFolder, targetBrand } = checkSetting(settings)
  if (!ok) return

  if (!isDir(newImagesFolder)) {
    return void consoleRed('new-images-folder 需為一個資料夾!')
  }

  const figmaPlaceExample = await terminalImage.file(path.resolve('.', 'hint-images/home-hints.png'), {
    width: '50%',
    height: '50%',
  })

  console.log('這些圖片是 home 頁面這裡的圖片')
  console.log(figmaPlaceExample)

  const imageResults = await Promise.all(
    ASSETS_IMAGES.map((imageInfo) => {
      const imageConsole = terminalImage.file(imageInfo.demoImagePath, {
        width: '10%',
        height: '10%',
        preserveAspectRatio: false,
      })
      return Promise.all([imageConsole, imageInfo])
    })
  )

  const checkboxOptions = imageResults.map((result, index) => {
    const [imageConsole, imageInfo] = result
    return {
      name: `${index + 1}. ${imageInfo.filename}: ${imageInfo.des}`,
      description: imageConsole,
      value: imageInfo,
      checked: true,
    }
  })

  const 選擇的圖片們 = await checkbox({
    message: '請把不需要的 images 取消勾選',
    choices: checkboxOptions,
    pageSize: checkboxOptions.length,
    loop: false,
  }).catch(() => null)
  if (選擇的圖片們 == null || 選擇的圖片們.length === 0) return void consoleRed('使用者取消勾選')

  const checkNeededImages = await checkAssetsImages(newImagesFolder, {
    選擇的圖片們,
    frontendRepoPath,
    targetBrand,
  })
  if (checkNeededImages.some((img) => !img.passFormat)) return

  const makeSure = await select({
    message: '檢查完畢，即將開始覆蓋 assets 相關的檔案，請確認清空 frontend repo 的 git status',
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

function checkAssetsImages(newImagesFolder, { 選擇的圖片們, frontendRepoPath, targetBrand } = {}) {
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
    newImagesList.map((filePath) => {
      const { base, ...others } = path.parse(filePath)
      return [base, { base, ...others, filePath }]
    })
  )

  return Promise.all(
    選擇的圖片們.map((neededImg) => {
      const newImageInfo = newImagesMap[neededImg.filename]

      const exist = newImageInfo != null

      if (!exist) {
        consoleRed(`${newImagesFolder} 裡缺少圖片 ${neededImg.filename}!`)
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
              const { width: rw, height: rh } = requiredSizeInfo
              return rw === nw && rh === nh
            })
          })()
          if (!passFormat) {
            console.log(otherInfo)
            consoleRed(
              `${otherInfo.filename} 尺寸不符! 需為 ${requiredSizeArray.map((item) => `${item.width}x${item.height}`).join('或')}, 得到 ${nw}x${nh}`
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

export const ASSETS_IMAGES = [
  {
    filename: 'Img-Safe.png',
    des: '用於首頁的 security 區塊, 可能會長得不太一樣',
    size: null,
    nameInFigma: 'Img-Safe',
    ext: '.png',
    path: 'assets',
  },
  {
    filename: 'ic-InHouse.png',
    des: '用於首頁的 security 區塊',
    size: [
      { width: 72, height: 73 },
      { width: 72, height: 72 },
    ],
    nameInFigma: 'ic-InHouse',
    ext: '.png',
    path: 'assets',
  },
  {
    filename: 'ic-Wallet.png',
    des: '用於首頁的 security 區塊',
    size: [
      { width: 72, height: 73 },
      { width: 72, height: 72 },
    ],
    nameInFigma: 'ic-Wallet',
    ext: '.png',
    path: 'assets',
  },
  {
    filename: 'ic-Funds.png',
    des: '用於首頁的 security 區塊',
    size: [
      { width: 72, height: 73 },
      { width: 72, height: 72 },
    ],
    nameInFigma: 'ic-Funds',
    ext: '.png',
    path: 'assets',
  },

  {
    filename: 'ic-Email.png',
    des: '用於首頁的 3 步驟簡單註冊區塊',
    size: [
      { width: 72, height: 73 },
      { width: 72, height: 72 },
    ],
    nameInFigma: 'ic-Email',
    ext: '.png',
    path: 'assets',
  },
  {
    filename: 'ic-Identity.png',
    des: '用於首頁的 3 步驟簡單註冊區塊',
    size: [
      { width: 72, height: 73 },
      { width: 72, height: 72 },
    ],
    nameInFigma: 'ic-Identity',
    ext: '.png',
    path: 'assets',
  },
  {
    filename: 'ic-Deposit.png',
    des: '用於首頁的 3 步驟簡單註冊區塊',
    size: [
      { width: 72, height: 73 },
      { width: 72, height: 72 },
    ],
    nameInFigma: 'ic-Deposit',
    ext: '.png',
    path: 'assets',
  },
].map((item) => ({
  ...item,
  demoImagePath: path.resolve(exampleImagesFolderPath, item.filename),
}))
