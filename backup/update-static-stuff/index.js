import select, { Separator } from '@inquirer/select'

import { 修改白牌會動到的東西 } from './console-utils.js'
import { s3LogStuff, svgLogoStuff } from './logo-svg-format-utils.js'
import { staticStuff } from './static-files-utils.js'
import { consoleRed } from './utils.js'
import { assetsStuff } from './assets-files-utils.js'
import { figmaStuff } from './figma-utils.js'

const CHOICES_LIST = [
  'LIST_ITEMS_LOG',
  'ASSETS_FILES',
  'SVG_LOGO',
  'S3_LOGO',
  'STATIC_FILES',
  'GENERATE_NEW_IMAGES_FROM_FIGMA_FOLDER',
]
const CHOICES_MAP = Object.fromEntries(CHOICES_LIST.map((item) => [item, item]))

start()

async function start() {
  console.log()

  const 現在要做啥 = await select({
    message: '你想做什麼: ',
    loop: false,
    pageSize: 10,
    choices: [
      {
        name: '我想要看白牌要調整的項目的清單',
        value: CHOICES_MAP.LIST_ITEMS_LOG,
        description: '列出各種需要留意的地方，但可能還是沒辦法齊全',
      },

      new Separator(),

      {
        name: '同步 assets 相關的檔案',
        value: CHOICES_MAP.ASSETS_FILES,
        description: '首頁相關的那些',
      },

      new Separator(),

      {
        name: '同步 LogoLight 和 LogoDark',
        value: CHOICES_MAP.SVG_LOGO,
        description: '將 SVG 的 Logo 轉成可用的 .vue 的形式並放到正確的位置',
      },

      {
        name: '同步 S3 那裡的 LogoLight 和 LogoDark',
        value: CHOICES_MAP.S3_LOGO,
        description: '將 Logo 的圖片放到 S3 的正確位置, 不含其它如 referral, task-and-reward 等等',
      },

      new Separator(),

      {
        name: '將從 figma 上載下來的檔案直接轉換到 new-images/static 資料夾中',
        value: CHOICES_MAP.GENERATE_NEW_IMAGES_FROM_FIGMA_FOLDER,
        description: '解壓縮相關的檔案到指定路徑，就可以動態產生可用的 static 靜態檔案',
      },

      {
        name: '同步 static 相關的靜態檔案',
        value: CHOICES_MAP.STATIC_FILES,
        description:
          '各種尺寸的 logo, 像是 PWA 和 favicon 等等, 在執行之前推薦執行「將從 figma 上載下來的檔案直接轉換到 new-images/static 資料夾中」',
      },
    ],
  }).catch(Function.prototype)

  switch (現在要做啥) {
    case CHOICES_MAP.LIST_ITEMS_LOG:
      return void 修改白牌會動到的東西()

    case CHOICES_MAP.ASSETS_FILES:
      return void assetsStuff()

    case CHOICES_MAP.SVG_LOGO:
      return void svgLogoStuff()

    case CHOICES_MAP.S3_LOGO:
      return void s3LogStuff()

    case CHOICES_MAP.GENERATE_NEW_IMAGES_FROM_FIGMA_FOLDER:
      return void figmaStuff()

    case CHOICES_MAP.STATIC_FILES:
      return void staticStuff()

    default:
      consoleRed('使用者取消')
  }
}
