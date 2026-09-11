import fs from 'fs'
import path from 'path'
import select, { Separator } from '@inquirer/select'

import { 修改白牌會動到的東西 } from './console-utils.js'
import { s3LogStuff, svgLogoStuff, svgToVue } from './logo-svg-format-utils.js'
import { staticStuff } from './static-files-utils.js'
import { checkSetting, consoleRed, consoleStep, parseJson, readSetting } from './utils.js'
import { homeAssetsStuff } from './assets-files-utils.js'
import { figmaStuff } from './figma-utils.js'
import { cleanLocalFolders } from './clean-utils.js'
import { fullSyncFromFigma } from './full-sync-utils.js'
import { pullFromFigma, readFigmaToken } from './figma/pull-from-figma.js'
import { pullAndSyncFromFigma } from './figma/pull-and-sync.js'
import { batchSyncFromFigma } from './figma/batch-sync.js'
import { checkFigmaToken } from './figma/check-token.js'
import { DEFAULT_MAX_RETRIES, DEFAULT_RETRY_DELAY_SECONDS } from './figma/rest.js'

// Interface 層: 讀 setting.json + 做淺層檢查 (存在/JSON 格式/有沒有對應的欄位/型別格式對不對)。
// 「target-brand 是否真的存在於 repo 路徑下」這種深層驗證不在這裡做, 留給消費端 (resolveBrand) 處理,
// 這樣不管參數是從這裡讀到的、還是別的 node 腳本直接寫死傳進來的, 都會過同一套驗證。
function loadSettings(requiredKeys) {
  const settings = readSetting()
  if (settings == null) return null

  const checked = checkSetting(settings, requiredKeys)
  if (!checked.ok) return null
  consoleStep('setting')

  return { ...checked, raw: settings }
}

const BATCH_ENTRIES_FILE_NAME = 'batch-sync.json'
const BATCH_ENTRIES_FILE_PATH = path.resolve('./', BATCH_ENTRIES_FILE_NAME)

// 批量同步用的清單檔案, 一樣只做淺層檢查 (存在 / JSON 格式 / 是不是陣列)。
// 每個項目的 targetBrand / figmaUrl 是否為非空字串、有沒有重複, 留給 batchSyncFromFigma 做深層驗證。
function loadBatchEntries() {
  if (!fs.existsSync(BATCH_ENTRIES_FILE_PATH)) {
    consoleRed(`找不到 ${BATCH_ENTRIES_FILE_NAME}, 請在專案根目錄建立這個檔案`)
    console.log(`可以先參考 ${BATCH_ENTRIES_FILE_NAME}.default, 複製一份改成自己要的內容:`)
    console.log(`   cp ${BATCH_ENTRIES_FILE_NAME}.default ${BATCH_ENTRIES_FILE_NAME}`)
    return null
  }

  const entries = parseJson(fs.readFileSync(BATCH_ENTRIES_FILE_PATH, 'utf8'))
  if (!Array.isArray(entries)) {
    consoleRed(`${BATCH_ENTRIES_FILE_NAME} 需為一個陣列!`)
    return null
  }
  consoleStep(BATCH_ENTRIES_FILE_NAME)

  return entries
}

// 會打 Figma API 的指令都用這組問一次: 撞到 429 rate limit 時要重試幾次、每次至少等多久。
// 問在前面 (interface 層), 不管是單一 brand 還是批量, 這次執行都用同一個決定。
async function askRetryOptions() {
  const maxRetries = await select({
    message: '撞到 Figma API 的 429 rate limit 時, 最多重試幾次?',
    choices: [
      { name: '不重試, 撞到就直接失敗', value: 0 },
      { name: `預設 (${DEFAULT_MAX_RETRIES} 次)`, value: DEFAULT_MAX_RETRIES },
      { name: '5 次', value: 5 },
      { name: '10 次 (比較容易撞到 rate limit 的情況, 例如批量併發)', value: 10 },
    ],
  }).catch(() => DEFAULT_MAX_RETRIES)

  if (maxRetries === 0) return { maxRetries, retryDelaySeconds: DEFAULT_RETRY_DELAY_SECONDS }

  const retryDelaySeconds = await select({
    message: '每次重試至少要等幾秒? (實際等待時間是這個值跟 Figma 回的秒數取較大值, Figma 常常回不到 10 秒, 等太短幾乎一定還會再撞到)',
    choices: [
      { name: '10 秒', value: 10 },
      { name: `預設/推薦 (${DEFAULT_RETRY_DELAY_SECONDS} 秒)`, value: DEFAULT_RETRY_DELAY_SECONDS },
      { name: '60 秒', value: 60 },
      { name: '120 秒 (常常撞到就用這個)', value: 120 },
    ],
  }).catch(() => DEFAULT_RETRY_DELAY_SECONDS)

  return { maxRetries, retryDelaySeconds }
}

const CHOICES_LIST = [
  'LIST_ITEMS_LOG',
  'CHECK_FIGMA_TOKEN',
  'PULL_AND_SYNC_FROM_FIGMA',
  'BATCH_SYNC_FROM_FIGMA',
  'PULL_FROM_FIGMA',
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
        name: '檢查 Figma token 是否可用 (preflight)',
        value: CHOICES_MAP.CHECK_FIGMA_TOKEN,
        description:
          '只打最輕量的 Figma API 確認 setting.json 裡的 figma-token 沒過期/沒被撤銷, 不會動到任何檔案。建議在跑任何 Figma 相關指令之前先跑這個',
      },

      new Separator(),

      {
        name: '★ 從 Figma 網址一路同步到 frontend / s3 repo（抓圖 + 同步）',
        value: CHOICES_MAP.PULL_AND_SYNC_FROM_FIGMA,
        description:
          '下面那兩個指令串起來, 全自動: 貼 Figma 網址 → 選 brand → 抓圖到 figma-images → 檢查 → 同步 static / Logo / AppIcon / 維護頁 logo / s3 Logo。會問兩次確認 (寫入 figma-images、覆蓋 repo)。任何一段出問題都可以退回用下面兩個指令分開跑',
      },

      {
        name: '★★ 批量: 一次貼多個 brand + Figma 網址, 併發同步',
        value: CHOICES_MAP.BATCH_SYNC_FROM_FIGMA,
        description:
          `讀取專案根目錄的 ${BATCH_ENTRIES_FILE_NAME} (陣列, 每個項目 { targetBrand, figmaUrl }), 每個 brand 用獨立暫存資料夾併發跑「抓圖 + 同步」, 彼此失敗互不影響, 最後印一份成功/失敗報告。無人值守, 不會跳任何確認`,
      },

      new Separator(),

      {
        name: '從 Figma 網址直接抓圖到 figma-images 資料夾',
        value: CHOICES_MAP.PULL_FROM_FIGMA,
        description:
          '取代「人工去 Figma 拖選 layer → export → 下載 → 解壓縮到 figma-images」這一段。會用 REST API 找到 assets page 的 export-area, 依 mapping 表檢查每個節點 (缺漏 / 尺寸 / 同名 / 底色 等), 再出圖到 figma-images。抓完之後照原本流程跑下面的「一次同步」即可, 這兩件事是分開的, 出問題隨時可以退回人工',
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

    case CHOICES_MAP.CHECK_FIGMA_TOKEN: {
      const s = loadSettings([])
      if (s == null) return
      const figmaToken = readFigmaToken(s.raw)
      if (figmaToken == null) return
      return void checkFigmaToken({ figmaToken })
    }

    case CHOICES_MAP.PULL_AND_SYNC_FROM_FIGMA: {
      const s = loadSettings([
        'frontend-repo-path',
        's3-repo-path',
        'new-images-folder',
        'figma-images-folders',
        'target-brand',
      ])
      if (s == null) return
      const figmaToken = readFigmaToken(s.raw)
      if (figmaToken == null) return
      const { maxRetries, retryDelaySeconds } = await askRetryOptions()
      return void pullAndSyncFromFigma({
        frontendRepoPath: s.frontendRepoPath,
        s3RepoPath: s.s3RepoPath,
        newImagesFolder: s.newImagesFolder,
        figmaImagesFolders: s.figmaImagesFolders,
        figmaToken,
        targetBrand: s.targetBrand,
        maxRetries,
        retryDelaySeconds,
      })
    }

    case CHOICES_MAP.BATCH_SYNC_FROM_FIGMA: {
      const s = loadSettings(['frontend-repo-path', 's3-repo-path'])
      if (s == null) return
      const figmaToken = readFigmaToken(s.raw)
      if (figmaToken == null) return
      const entries = loadBatchEntries()
      if (entries == null) return

      // 批次是併發跑的, 沒辦法像單一 brand 那樣每個 brand 出問題時各自跳出來問一次,
      // 所以在開始之前先問一次, 這次批次统一怎麼處理「抓圖沒有全部成功」的 brand。
      const continueOnPartialFetch = await select({
        message: '批次裡某個 brand 抓圖沒有全部成功 (部分資產被跳過) 時, 這次要怎麼處理那個 brand?',
        choices: [
          { name: '跳過, 不要往下同步 (保守, 推薦)', value: false },
          { name: '繼續同步, 讓同步階段的來源檔案檢查自己擋', value: true },
        ],
      }).catch(() => false)
      // 批量併發打 Figma API, 比單一 brand 更容易撞到 429, 一樣先問再統一套用到每個 brand
      const { maxRetries, retryDelaySeconds } = await askRetryOptions()

      return void batchSyncFromFigma({
        entries,
        frontendRepoPath: s.frontendRepoPath,
        s3RepoPath: s.s3RepoPath,
        figmaToken,
        continueOnPartialFetch,
        maxRetries,
        retryDelaySeconds,
      })
    }

    case CHOICES_MAP.PULL_FROM_FIGMA: {
      const s = loadSettings(['figma-images-folders'])
      if (s == null) return
      const figmaToken = readFigmaToken(s.raw)
      if (figmaToken == null) return
      const { maxRetries, retryDelaySeconds } = await askRetryOptions()
      return void pullFromFigma({ figmaImagesFolders: s.figmaImagesFolders, figmaToken, maxRetries, retryDelaySeconds })
    }

    case CHOICES_MAP.FULL_SYNC_FROM_FIGMA: {
      const s = loadSettings([
        'frontend-repo-path',
        's3-repo-path',
        'new-images-folder',
        'figma-images-folders',
        'target-brand',
      ])
      if (s == null) return
      return void fullSyncFromFigma({
        frontendRepoPath: s.frontendRepoPath,
        s3RepoPath: s.s3RepoPath,
        newImagesFolder: s.newImagesFolder,
        figmaImagesFolders: s.figmaImagesFolders,
        targetBrand: s.targetBrand,
      })
    }

    case CHOICES_MAP.SVG_TO_VUE:
      return void svgToVue()

    case CHOICES_MAP.ASSETS_FILES: {
      const s = loadSettings(['frontend-repo-path', 'new-images-folder', 'target-brand'])
      if (s == null) return
      return void homeAssetsStuff({
        frontendRepoPath: s.frontendRepoPath,
        newImagesFolder: s.newImagesFolder,
        targetBrand: s.targetBrand,
      })
    }

    case CHOICES_MAP.SVG_LOGO: {
      const s = loadSettings(['frontend-repo-path', 'new-images-folder', 'target-brand'])
      if (s == null) return
      return void svgLogoStuff({
        frontendRepoPath: s.frontendRepoPath,
        newImagesFolder: s.newImagesFolder,
        targetBrand: s.targetBrand,
      })
    }

    case CHOICES_MAP.S3_LOGO: {
      const s = loadSettings(['frontend-repo-path', 's3-repo-path', 'new-images-folder', 'target-brand'])
      if (s == null) return
      return void s3LogStuff({
        frontendRepoPath: s.frontendRepoPath,
        s3RepoPath: s.s3RepoPath,
        newImagesFolder: s.newImagesFolder,
        targetBrand: s.targetBrand,
      })
    }

    case CHOICES_MAP.GENERATE_NEW_IMAGES_FROM_FIGMA_FOLDER: {
      const s = loadSettings(['new-images-folder', 'figma-images-folders'])
      if (s == null) return
      return void figmaStuff({ newImagesFolder: s.newImagesFolder, figmaImagesFolders: s.figmaImagesFolders })
    }

    case CHOICES_MAP.STATIC_FILES: {
      const s = loadSettings(['frontend-repo-path', 'new-images-folder', 'target-brand'])
      if (s == null) return
      return void staticStuff({ frontendRepoPath: s.frontendRepoPath, newImagesFolder: s.newImagesFolder, targetBrand: s.targetBrand })
    }

    case CHOICES_MAP.CLEAN_LOCAL_FOLDERS: {
      const settings = readSetting() ?? {}
      return void cleanLocalFolders({
        newImagesFolder: typeof settings['new-images-folder'] === 'string' ? settings['new-images-folder'] : null,
        figmaImagesFolders:
          typeof settings['figma-images-folders'] === 'string' ? settings['figma-images-folders'] : null,
      })
    }

    default:
      consoleRed('使用者取消')
  }
}
