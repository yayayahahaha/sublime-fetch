import select, { Separator } from '@inquirer/select'

import { 修改白牌會動到的東西 } from './console-utils.js'
import { s3LogStuff, svgLogoStuff, svgToVue } from './logo-svg-format-utils.js'
import { staticStuff } from './static-files-utils.js'
import { consoleRed } from './utils.js'
import { homeAssetsStuff } from './assets-files-utils.js'
import { figmaStuff } from './figma-utils.js'
import { cleanLocalFolders } from './clean-utils.js'
import { fullSyncFromFigma } from './full-sync-utils.js'

const CHOICES_LIST = [
  'LIST_ITEMS_LOG',
  'FULL_SYNC_FROM_FIGMA',
  'ASSETS_FILES',
  'SVG_LOGO',
  'S3_LOGO',
  'STATIC_FILES',
  'GENERATE_NEW_IMAGES_FROM_FIGMA_FOLDER',
  'SVG_TO_VUE',
  'CLEAN_LOCAL_FOLDERS',
]
const CHOICES_MAP = Object.fromEntries(CHOICES_LIST.map((item) => [item, item]))

start()

async function start() {
  console.log()

  const 現在要做啥 = await select({
    message: '你想做什麼: ',
    loop: false,
    pageSize: 15,
    choices: [
      {
        name: '我想要看白牌要調整的項目的清單',
        value: CHOICES_MAP.LIST_ITEMS_LOG,
        description: '列出各種需要留意的地方，但可能還是沒辦法齊全',
      },

      new Separator(),

      {
        name: '一次同步 Figma 匯出的 static 圖片 + Logo（含 s3 repo）',
        value: CHOICES_MAP.FULL_SYNC_FROM_FIGMA,
        description:
          '整合「將 figma 檔案轉 static」+「同步 static 檔案」+「同步 LogoLight/Dark/AppIcon/維護頁 logo」+「同步 S3 Logo」, 會一次檢查完所有來源檔案再一次寫入, 需要 figma-images 資料夾裡有齊全的 static 來源 + logo-light/dark 的 svg 和 png + qrcode-logo.svg',
      },

      new Separator(),

      {
        name: '把 svg 換成可用的 vue icon',
        value: CHOICES_MAP.SVG_TO_VUE,
        description: '外面包一層 <Icon>, 替換 id 等等',
      },

      new Separator(),

      {
        name: '同步 home assets 相關的檔案',
        value: CHOICES_MAP.ASSETS_FILES,
        description: '首頁相關的那些',
      },

      new Separator(),

      {
        name: '同步 LogoLight / LogoDark / AppIcon / 維護頁 logo',
        value: CHOICES_MAP.SVG_LOGO,
        description:
          '將 SVG 的 Logo 轉成可用的 .vue 的形式並放到正確的位置, 並用 logo-dark.svg 產生維護頁的 <brand>-logo.svg。需要 logo-light.svg, logo-dark.svg, qrcode-logo.svg',
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
        description: 'icon 和 meta 的那些。解壓縮相關的檔案到指定路徑，就可以動態產生可用的 static 靜態檔案',
      },

      {
        name: '同步 static 相關的靜態檔案',
        value: CHOICES_MAP.STATIC_FILES,
        description:
          '各種尺寸的 logo, 像是 PWA 和 favicon 等等, 在執行之前推薦執行「將從 figma 上載下來的檔案直接轉換到 new-images/static 資料夾中」',
      },

      new Separator(),

      {
        name: '清除本機 source / 暫存資料夾',
        value: CHOICES_MAP.CLEAN_LOCAL_FOLDERS,
        description:
          'svg-to-vue-images, svg-to-vue-images-result, new-images-folder, figma-images-folders 的內容 (此動作不會動到 frontend / s3 repo)',
      },
    ],
  }).catch(Function.prototype)

  switch (現在要做啥) {
    case CHOICES_MAP.LIST_ITEMS_LOG:
      return void 修改白牌會動到的東西()

    case CHOICES_MAP.FULL_SYNC_FROM_FIGMA:
      return void fullSyncFromFigma()

    case CHOICES_MAP.SVG_TO_VUE:
      return void svgToVue()

    case CHOICES_MAP.ASSETS_FILES:
      return void homeAssetsStuff()

    case CHOICES_MAP.SVG_LOGO:
      return void svgLogoStuff()

    case CHOICES_MAP.S3_LOGO:
      return void s3LogStuff()

    case CHOICES_MAP.GENERATE_NEW_IMAGES_FROM_FIGMA_FOLDER:
      return void figmaStuff()

    case CHOICES_MAP.STATIC_FILES:
      return void staticStuff()

    case CHOICES_MAP.CLEAN_LOCAL_FOLDERS:
      return void cleanLocalFolders()

    default:
      consoleRed('使用者取消')
  }
}
