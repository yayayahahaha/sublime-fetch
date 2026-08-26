# 從 Figma 抓圖

取代「人工去 Figma 拖選 layer → export → 下載 → 解壓縮到 `figma-images/`」這一段。

```
Figma REST API ──→ figma-images/ ──→ new-images/static ──→ frontend repo / s3 repo
└────── 抓圖 ──────┘ └───────────── 一次同步 ───────────────────────────┘
└──────────────── 抓圖 + 同步（全自動）─────────────────────────────────┘
```

## 三層架構

抓圖的邏輯只有一份，三種用法都是薄薄一層包在外面：

```
figma/fetch-assets.js   fetchFigmaAssets(options) → Promise<result>
                        純函式, 不印任何東西、不問任何問題
        ↑                        ↑
figma/cli.js            figma/pull-from-figma.js
一行指令跑完             互動式 (問完問題再呼叫核心)
```

`figma/report.js` 負責把 result 物件轉成給人看的行，CLI 和互動式共用同一份排版。

### 核心函式

```js
import { fetchFigmaAssets } from './figma/fetch-assets.js'

const result = await fetchFigmaAssets({
  figmaUrl: 'https://www.figma.com/...',     // 必填, 也接受直接給 file key
  figmaToken: '...',                         // 必填, scope 要 file_content:read
  outputDir: './figma-images',               // 必填, 相對路徑用 process.cwd() 解析
  clearOutputDir: false,                     // 選填, 寫入前是否清空
  dryRun: false,                             // 選填, 只檢查不出圖 (不下載圖片, 很便宜)
  verbose: false,                            // 選填, 印步驟 log (前綴 [figma])
})
```

抓圖不需要 brand —— mapping 表全 brand 共用一份，輸出目錄也是呼叫端給的。

**不會 throw**，所有錯誤都變成 `status` + `error`。

`verbose: false`（預設）時是**真的完全不碰 `console` / `process.stdout` / `process.stderr`**，
結果全部在回傳值裡。要印給人看就把 result 丟給 `report.js` 的 `formatFetchResult()`。

### 結果物件

| 欄位 | 說明 |
| --- | --- |
| `ok` | 是否全部成功 |
| `status` | 見下表 |
| `outputDir` / `dryRun` | 回放輸入 |
| `file` | `{ key, name, version }` |
| `page` | `{ id, name }`，找到才有 |
| `exportArea` | `{ name, nodeId, firstLevelCount, ignoredTextNames, checkedCount }` |
| `allPageNames` | 全部 page 名字（找不到 page 時用來判斷是不是被改名） |
| `candidates` | `[{ pageId, pageName, nodeId }]`，找到的 export-area（多於一個時就是錯誤） |
| `findings` | `[{ level, code, key, message }]` |
| `assets` | `[{ key, nodeName, outputName, nodeId, nodeType, width, height, exports }]`，通過檢查、會出圖的。`key` = mapping 正規名，`nodeName` = Figma 上實際的圖層名，`outputName` = 檔名前綴 |
| `skipped` | `[{ key, codes }]`，mapping 表裡有但因 error 被跳過的 |
| `written` | `[{ fileName, assetKey, filePath, bytes, format, local }]`，`local: true` 表示這張是本機 Chromium 畫的 |
| `failures` | `[{ fileName, assetKey, reason }]` |
| `cleared` | 被清掉的檔名（`clearOutputDir: true` 時） |
| `error` | `{ message }` 或 `null` |

| `status` | 意思 |
| --- | --- |
| `success` | 全部完成 |
| `partial` | 有寫入，但有資產被跳過或有檔案失敗 |
| `dry-run` | `dryRun: true` 的結果，沒有寫任何東西 |
| `no-assets` | 沒有任何資產通過檢查 |
| `multiple-export-areas` | 多個 page 都有 `export-area`。這是 Figma 檔案結構的問題，**直接當錯誤**，不猜也不讓人選，去找設計確認只留一個 |
| `page-not-found` / `export-area-not-found` | 定位失敗，看 `allPageNames` / `candidates` |
| `invalid-input` / `invalid-url` / `api-error` | 看 `error.message` |

### CLI

```sh
node figma/cli.js --url <figma 網址> --out ./figma-images --token-file ./figma-token.json --clear
```

token **只能**走 `--token-file`，而且是必填。檔案是 JSON，裡面要有 `token` 這個 key：

```json
{ "token": "figd_xxxxxxxx" }
```

不做 `--token <值>` 是因為直接寫在指令裡會進 shell history，也會出現在 `ps` 的輸出。
token-file 的各種出錯（檔案不存在 / 是資料夾 / 沒權限 / JSON 壞掉 / 不是 object / 沒有 `token` key / `token` 是空字串）
都有各自看得懂的訊息，`token` key 打錯時還會列出檔案裡實際有哪些 key。

其他：`--dry-run`、`--verbose`、`--json`、`--help`。

exit code：`0` 全部完成（`--dry-run` 時代表檢查沒有 error）/ `1` 部分完成 / `2` 沒有完成。

`--json` 是給程式吃的：印出完整結果物件，不印給人看的報告。用途是接管道或給別的腳本呼叫，例如

```sh
# CI 裡只想知道有哪些 error
node figma/cli.js --url ... --out ... --token-file ... --dry-run --json | jq '.findings[] | select(.level == "error")'

# 確認這次真的寫了哪些檔案
node figma/cli.js ... --json | jq -r '.written[].fileName'
```

單純自己在終端機跑的話不需要它，看預設的報告就好。

### 互動式

先跑一次 `dryRun` 把報告印出來，確認之後才真的出圖——`dryRun` 只打 metadata 請求、不下載圖片，
所以多這一趟幾乎沒有成本，但保住了「先看檢查結果再決定要不要寫」這件事。

真正出圖那次會開 `verbose`，因為那段會跑一陣子（要向 Figma 要 9 組圖），需要看得到進度。

## 三個指令

| 指令 | 做什麼 |
| --- | --- |
| **抓圖 + 同步** (`pull-and-sync.js`) | 全自動，下面兩個串起來 |
| **從 Figma 抓圖** (`pull-from-figma.js`) | 只填滿 `figma-images/` |
| **一次同步**（既有，`full-sync-utils.js`） | 只從 `figma-images/` 往 repo 同步 |

**三個都留著是刻意的。** 抓圖那段出問題就退回人工 export 到 `figma-images/` 再跑「一次同步」；
同步那段出問題就用「從 Figma 抓圖」把圖抓好再自己處理。合併成一個就沒有這個退路了。

「抓圖 + 同步」的問題全部問在前面（先選 brand、再貼網址），
所以長時間的抓圖跑到一半不會又跳出問題要你回答。中間有兩次確認：寫入 `figma-images` 一次、覆蓋 repo 一次。

抓圖階段如果有 error（表示有資產被跳過），會先問要不要往下同步；
選繼續的話，缺的檔案會在同步階段的來源檔案檢查被擋下來。

## 設定

`setting.json` 需要：

| key | 用途 |
| --- | --- |
| `figma-images-folders` | 輸出目錄（就是既有流程的來源目錄） |
| `figma-token` | Figma personal access token，scope 要勾 **`file_content:read`** |

`setting.json` 已經在 `.gitignore` 裡，token 不會進版控。

Token 產生：<https://www.figma.com/developers/api#access-tokens>

> `/v1/me` 會回 403 是正常的（那需要 `current_user:read` scope），不影響本工具。

## 流程

1. 貼 Figma 網址（`/design/<fileKey>/...` 或 `/file/<fileKey>/...`，也接受直接貼 file key）
2. `GET /files/:key?depth=1` → 候選 page = **名字含 `asset`**（case-insensitive）
3. `GET /files/:key/nodes?ids=<候選 page ids>&depth=1` → 在每個候選 page 的**第一層**找名字等於 `export-area` 的節點（trim + lowercase）
   - 0 個 → 中止，並列出檔案裡所有 page 名字
   - 1 個 → 直接用
   - N 個 → 讓使用者單選（不猜）
4. `GET /files/:key/nodes?ids=<export-area>` → 抓完整 subtree（實測 70–135 KB / 93–175 個 node，一次抓完最省事）
5. 取 `export-area` 的**第一層**節點當檢查母體
6. 檢查（見下）
7. `GET /images/:key` 出圖 → 後處理 → 寫進 `figma-images/`

### 為什麼用「含 asset 的 page」而不是固定名字

兩個真實檔案的 page 名字並不一樣：

- BTSE Indonesia：`🧩  icon & assets`
- ZMO：`🧩  Logos & Assets ✅`

（emoji 後面是兩個空白、一邊是 `icon` 一邊是 `Logos`、還有尾綴 ✅）

所以名字只負責**縮小範圍**，真正決定的是「裡面有沒有 `export-area`」——把模糊性從字串比對轉移到結構驗證。
`export-area` 這個名字在兩個檔案裡是完全一致的。

## Mapping 表

`mapping.js` 的 `EXPORT_MAP`，**全 brand 共用一份**。

一筆 spec 有**三個可能不同的名字**，分清楚很重要：

| 欄位 | 是什麼 |
| --- | --- |
| `key` | mapping 表裡的正規名字。findings / report 都用這個當識別 |
| `aliases` | 除了 `key` 以外還接受哪些 Figma 圖層名 |
| `outputName` | 輸出檔名的前綴，不給就等於 `key` |

輸出檔名 = `${outputName ?? key}${suffix}.${ext}`，這是 Figma 自己 export 的檔名慣例，
刻意對齊 `figma-utils.js` 的 `FIGMA_IMAGES.filename`，所以產出可以直接餵給既有流程，**下游一行都不用改**。

### 圖層名字怎麼比對

比對前先**正規化**：轉小寫、去掉 `-` `_` 和空白。
所以 `pwa-icon` / `PWA_icon` / `pwa_icon` / `PWA Icon` 全都是同一個。

`aliases` 只需要放「真的不同的字」（`logo-brand` vs `logo-dark`），
純粹是大小寫或分隔符號的差異不用寫。

**一個 spec 命中多個不同名字時報 `MULTI-MATCH` error**（例如 Figma 上同時有 `PWA_icon` 和 `pwa-icon`）——
不猜，讓人去把 Figma 整理成只留一個。

刻意**不用 regexp 當 matcher**：regexp 容易過度命中（`/logo/i` 會同時打到 `logo-light`、`_wl-logo`、
`qrcode-logo`，變成每次都 `MULTI-MATCH`），正規化後做完全比對則不可能誤傷別人。

| `key` | 接受的圖層名 | 節點期望尺寸 | 輸出 |
| --- | --- | --- | --- |
| `pwa-icon` | `pwa-icon` | 64×64, 需不透明底 | **`PWA_icon{16..512}.png`** × 8 |
| `favicon` | `favicon` | 64×64, 需不透明底 | `favicon.svg` + `favicon.ico` |
| `img-social-a` | `img-social-a` | 400×400 | `img-social-a.png` |
| `img-social-b` | `img-social-b` | 1200×675 | `img-social-b.png` |
| `qrcode-logo` | `qrcode-logo` | 13×13 | `qrcode-logo.svg` |
| `logo-white` | `logo-white` / `logo-light` | 各 brand 自由 | **`logo-light.svg` + `logo-light.png`** (@2x) |
| `logo-brand` | `logo-brand` / `logo-dark` | 各 brand 自由 | **`logo-dark.svg` + `logo-dark.png`** (@2x) |

`outputName` 出現的原因有兩種：

- `pwa-icon` → `PWA_icon*`：設計端要改叫 `pwa-icon`，但下游 `FIGMA_IMAGES` 在等 `PWA_icon16.png` 這個檔名
- `logo-white` → `logo-light*`、`logo-brand` → `logo-dark*`：設計端覺得「白色 / 品牌色」比
  「light / dark」更好懂（`logo-white` 是白色 logo，用在深色底；`logo-brand` 是品牌色 logo，用在淺色底），
  但 FE 的 usage 和下游 `LOGO_SOURCE_FILE_NAMES` 都是 `logo-light` / `logo-dark`

`LOGO_PAIR` 裡放的是 **`key`**（`['logo-white', 'logo-brand']`），
所以圖層即使是用 alias（`logo-light` / `logo-dark`）命名，那條成對檢查一樣抓得到。
新舊命名可以混用、也可以分批改，但同一支的兩種寫法不能並存（會報 `MULTI-MATCH`）。

`PWA_icon` 的 48 / 156 下游目前用不到，但 Figma 上本來就有就一起帶出來。

### Figma 上的 exportSettings 一律不讀

Mapping 表是唯一真理。原因是兩個真實檔案的 `exportSettings` 本身就不一致、也有設錯：

| 資產 | BTSE Indonesia | ZMO |
| --- | --- | --- |
| `img-social-a` | PNG + SVG（suffix `@2x`） | PNG only |
| `img-social-b` | PNG + SVG | PNG only |
| `support-logo-a` | 4×PNG + SVG | 4×PNG + SVG + @4x PNG |
| `qrcode-logo` | COMPONENT | FRAME |

（`img-social-a` 的 SVG 設了 suffix `@2x`——SVG 是向量，`@2x` 沒有意義。）

### logo 命名

目前 Figma 上 logo 節點還叫 `logo-BTSE-id_2`（×3）/ `_wl-logo`（×2），所以會被 `DUP` + `MISSING` 擋下來。
設計整理成 `logo-white` / `logo-brand` 各一個之後就會通。這是預期行為，不是 bug。

給設計的圖層命名清單在 `DESIGN_CHECKLIST.md`。

## 檢查規則

第一層的 `TEXT` 節點**全部丟棄**——那些是設計寫給人看的標註（`16*16`、`width: 240`、`Use ICO exporter` 之類），
而且已證實會過時（favicon 旁邊標 `16*16`，節點其實是 64×64）。

| 代號 | 規則 | 級別 |
| --- | --- | --- |
| `DUP` | 第一層有同名節點 | error |
| `MULTI-MATCH` | 一個 spec 命中多個不同名字的圖層（如 `PWA_icon` + `pwa-icon` 並存） | error |
| `UNKNOWN` | 沒被任何 spec 認領 | warn |
| `MISSING` | mapping 表裡有，Figma 沒有 | error |
| `TYPE` | type 不在 FRAME / COMPONENT / INSTANCE | error |
| `SIZE` | 節點尺寸與 `expect` 不符 | error |
| `KIND` | 要出 SVG 但底下有點陣圖 fill（SVG 會內嵌 base64） | error |
| `LOGO-PAIR` | `logo-light` 與 `logo-dark` 尺寸不一致 | error |
| `SOURCE-RES` | 原始點陣圖解析度小於最大輸出寬 | warn |
| `FRACTIONAL` | 節點尺寸不是整數 | warn |
| `OVERFLOW` | `absoluteRenderBounds` 超出 `absoluteBoundingBox`（陰影／描邊） | warn |
| `ALPHA` | 標了 `opaque` 但節點沒有可見的實心 fill | warn |
| `STATE` | hidden / opacity < 1 / locked | info |

**全程 partial success**：某個資產有 error 只會跳過那一個，其餘照樣檢查、照樣出圖。
這是刻意的——現在兩個真實檔案都會因為 logo 命名而有 error，如果一個 error 就全擋，工具第一天就沒人願意用。

幾條規則的取捨說明：

- `LOGO-PAIR` 是從下游 `checkLogoLightAndLogoDark` 的 `sameSize` 硬要求往上游搬的，提前在 Figma 端攔掉。
- `SOURCE-RES` 只能拿「資產的最大輸出寬」跟原圖寬比——沒辦法知道那張 fill 在畫面上實際被縮放多少，
  所以是 warn 不是 error，避免誤擋可以出的圖。
- `OVERFLOW` 在 TEXT 上是純噪音（TEXT 的 boundingBox 含行高留白），但 TEXT 已經被丟掉了，
  在非 TEXT 節點上實測零誤報。
- `ALPHA` 原本是防「拿到透明背景的 Support-a 版而不是 PWA / Favicon 版」。本工具按 `node.name` 抓，
  結構上不可能拿錯，所以這條退化成 sanity check。

## 兩個實作上的限制

### 1. REST 的 scale 上限是 4

Figma UI 上可以手動輸入 `512w` 且沒有上限，但 REST `/v1/images` **只有 `scale` 參數、範圍 0.01–4**
（實測 `scale=8` 回 `400 Parameter 'scale' must be between 0.01 and 4`）。

`PWA_icon` 節點是 64×64，要出 512 就是 8×，超過上限。

處理方式：換算後的 scale 超過 4 時，改成**拿 SVG 回來用 Chromium (puppeteer) 畫成目標尺寸**。
向量來源所以不會模糊，但 antialiasing 是 Chromium 算的，跟 Figma 自己算的有極細微差異。
**console 會明確列出哪幾個檔案是這樣來的**，第一次用建議肉眼確認。

目前實際只有 `PWA_icon512.png` 走這條路，其他都 ≤ 3×。

驗證結果（工具產出 vs 現有手動同步進 repo 的 zmo 檔案，先合成到白底再逐像素比）：

| 檔案 | 差異像素 | maxDiff | 結論 |
| --- | --- | --- | --- |
| `favicon.svg` → `icon.svg` | — | — | 位元組完全相同 |
| `PWA_icon16/32/150` | 1.8–18.8% | ≤ 2 | 等同相同（抗鋸齒進位差） |
| `PWA_icon180/192` | ~1.3% | 15–17 | 只有邊緣像素，avgDiff 0.01 |
| `img-social-a/b` | < 0.5% | 15–16 | 只有邊緣像素，avgDiff 0.00 |
| `PWA_icon512`（本機算的） | 0.58% | 95 | 邊緣抗鋸齒差異，肉眼一致 |

### 2. favicon.ico 自己編碼

以前 `.ico` 要設計另外用 ICO exporter plugin 轉好、丟 PRD 附件、再手動放進來，
下游還得用 `requiredType: 'ico'` 防「拿 png 改名」。

ICO 從 Vista 起就允許直接內嵌 PNG payload，所以 `ico.js` 自己組 header 就能徹底省掉那個人工步驟。

**注意**：現有 production 的 `favicon.ico` 其實內嵌了 **4 個尺寸**（16/32/48/64，BMP payload，32870B），
不是單一 64×64。本工具目前按需求只出 64（714B）。

`favicon` 節點是 64×64，所以 16/32/48 換算後的 scale 都在 REST 上限內，
要跟 production 一致的話把 `mapping.js` 裡的 `sizes` 改成 `[16, 32, 48, 64]` 就好，沒有額外成本
（實測產出 2143B，4 個尺寸、PNG payload，比 BMP 版小 15 倍）。

## 目標資料夾會被清空

下游 `readFilesMapByName` 是**用檔名遞迴索引**來源檔案的，
所以上一輪別的 brand 留下來的同名檔案會被誤當成這一輪的內容。

寫入前會列出資料夾現有內容並預設建議先清空。選「直接覆蓋」的話請自己確認殘留檔案。

## 檔案

| 檔案 | 職責 |
| --- | --- |
| `mapping.js` | mapping 表、圖層名正規化與比對、node type 白名單、export 項目 → render 計畫的換算 |
| `rest.js` | Figma REST API、網址解析、HTTP 錯誤碼對應的提示 |
| `checks.js` | 純檢查邏輯（不碰網路、不碰檔案系統） |
| `ico.js` | ICO 編碼 |
| `rasterize.js` | SVG → PNG（puppeteer），只有 scale > 4 時會用到 |
| `fetch-assets.js` | **核心**：定位 + 檢查 + 出圖 + 寫檔。無 console、無互動、不 throw |
| `report.js` | 結果物件 → 給人看的行，CLI 和互動式共用 |
| `cli.js` | CLI 介面 |
| `pull-from-figma.js` | 互動式抓圖（`runInteractiveFetch` 給合併指令共用） |
| `pull-and-sync.js` | 抓圖 + 同步的合併指令 |

`full-sync-utils.js` 的 `fullSyncFromFigma()` 多了一個 optional 的 `{ targetBrand }`，
讓合併指令可以把 brand 先選好再傳進去。不傳就跟以前一樣自己問，向後相容。
