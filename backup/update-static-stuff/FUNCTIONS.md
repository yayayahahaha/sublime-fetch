# Function 說明文件

這份文件描述 `index.js` 選單背後實際做事的 function，目的是讓它們可以被**其他 node 腳本直接 import 呼叫**，不一定要透過 `index.js` 的互動選單 / `setting.json`。

## 架構: 兩層驗證

```
setting.json / 互動選單 / 其他 node 腳本寫死的參數
              │
              ▼
   interface 層 (index.js: loadSettings)
   —— 淺層檢查: 檔案存在、JSON 格式、必要欄位有沒有給、型別/路徑格式對不對
              │
              ▼
   消費端 function (staticStuff, fullSyncFromFigma...)
   —— requireParams: 必要參數是不是非空字串
   —— resolveBrand: targetBrand 是否真的存在於 frontendRepoPath / s3RepoPath 底下
              │
              ▼
        實際讀寫檔案
```

不管參數是從 `setting.json` 讀到的、互動選單選出來的、還是別的 node 腳本直接寫死傳進來的，都會經過同一套驗證，不會因為來源不同而漏檢查。

**Interactive override 參數**: 每個 function 原本會跳出來問人的地方（選 brand、確認覆蓋、清空資料夾、部分抓圖失敗要不要繼續）都有對應的參數可以直接帶值跳過。不給就維持原本互動行為，給了就不會再問——這是無人值守呼叫的關鍵。

---

## `utils.js`

### `readSetting()`
讀取專案根目錄的 `setting.json`，回傳 parse 後的物件；檔案不存在或 JSON 格式錯誤回 `null`。

### `checkSetting(setting, requiredKeys)`
對 `setting` 物件做**淺層檢查**：`requiredKeys` 列出的欄位是否存在、型別是不是字串、`*-repo-path` 是不是絕對路徑、`*-folder(s)` 是不是相對路徑 (`./` 開頭)。`target-brand` 一律 optional。回傳 `{ ok, frontendRepoPath, s3RepoPath, newImagesFolder, figmaImagesFolders, targetBrand }`（用 camelCase key，方便直接展開傳給消費端 function）。

只給 interface 層用；消費端不會呼叫這個。

### `requireParams(params, keys)`
消費端用的防呆：檢查 `keys` 對應的每個值是不是非空字串，不是就印紅字、回 `false`。呼叫端看到 `false` 要直接 `return`，不要往下跑。

---

## `brand-utils.js`

### `resolveBrand({ targetBrand, frontendRepoPath, s3RepoPath })`
**brand 驗證的統一入口**，所有需要 brand 的消費端 function 都是呼叫這個。

- 有給 `targetBrand`：驗證 `brand-${targetBrand}` 資料夾是否存在於 `frontendRepoPath/src` 底下（如果有給 `frontendRepoPath`）、`${targetBrand}` 資料夾是否存在於 `s3RepoPath` 底下（如果有給 `s3RepoPath`）。驗證失敗回 `null`，並印出是哪個路徑對不上。
- 沒給 `targetBrand`：跳互動選單讓人從 `frontendRepoPath/src` 底下的 `brand-*` 資料夾挑，選完一樣會驗證 `s3RepoPath` 那邊。**這個分支需要 TTY**，無人值守呼叫一定要自己帶 `targetBrand`。

回傳驗證通過的 brand 字串（不含 `brand-` 前綴），或 `null`。

### `pickBrand(frontendRepoPath)`
純粹列出 `frontendRepoPath/src` 底下的 `brand-*` 資料夾給人選，`resolveBrand` 內部用，一般不需要直接呼叫。

---

## 消費端 function 一覽

每個都是 `async function`（除了少數同步的 `check*` helper），全部用單一物件參數。沒有 `?` 是必要參數（缺了 `requireParams` 會印紅字並讓 function 直接 `return`，不會拋例外）；有 `?` 是可選的 override。

### `static-files-utils.js` / `staticStuff(options)`

同步各種尺寸的 favicon / PWA icon / meta 圖到 frontend repo。

| 參數 | 必要 | 說明 |
|---|---|---|
| `frontendRepoPath` | ✅ | frontend repo 的絕對路徑 |
| `newImagesFolder` | ✅ | 來源圖片資料夾（相對路徑），底下要有 `static/` 子資料夾 |
| `targetBrand` | | 見 `resolveBrand` |
| `skipConfirm` | | `true` 就跳過「即將覆蓋 repo」的確認，直接寫入 |

流程：`newImagesFolder/static` 底下的 11 個必要圖片（見 `STATIC_IMAGES`）逐一檢查尺寸 / 格式 → 全過才進到確認步驟 → 複製到 `frontendRepoPath/src/brand-${targetBrand}/bundle/public/...`。

### `assets-files-utils.js` / `homeAssetsStuff(options)`

同步首頁用的 assets 圖片（`img-token.png`、`Img-Safe.png` 等）。

| 參數 | 必要 | 說明 |
|---|---|---|
| `frontendRepoPath` | ✅ | |
| `newImagesFolder` | ✅ | 來源圖片資料夾 |
| `targetBrand` | | |
| `selectedImages` | | `ASSETS_IMAGES` 的 filename 陣列，帶了就不會跳互動勾選，直接用這份清單 |
| `skipConfirm` | | |

### `logo-svg-format-utils.js`

#### `svgLogoStuff(options)`
把 `logo-light.svg` / `logo-dark.svg` / `qrcode-logo.svg` 轉成 `LogoLight.vue` / `LogoDark.vue` / `AppIcon.vue`，並用 `logo-dark.svg` 產生維護頁的 `<brand>-logo.svg`。

| 參數 | 必要 | 說明 |
|---|---|---|
| `frontendRepoPath` | ✅ | |
| `newImagesFolder` | ✅ | 底下要有 `logos/` 子資料夾 |
| `targetBrand` | | |
| `skipConfirm` | | |

副作用：也會更新 `generalConfig.js` 裡的 `headerLogoHeight`。維護頁 logo 是 optional 的——`frontendRepoPath/src/brand-${targetBrand}/bundle/maintenance-mode/index.html` 不存在，或裡面沒引用本地 svg，就跳過（不算失敗）。

#### `s3LogStuff(options)`
把 `logo-light` / `logo-dark` 的 png + svg 放到 s3 repo。

| 參數 | 必要 | 說明 |
|---|---|---|
| `frontendRepoPath` | ✅ | **只用來驗證 brand 在 frontend 那邊也存在**，不會拿來組路徑 |
| `s3RepoPath` | ✅ | |
| `newImagesFolder` | ✅ | 底下要有 `logos/` 子資料夾 |
| `targetBrand` | | |
| `skipConfirm` | | |

#### `svgToVue(options)`
獨立小工具，跟 `setting.json` 無關：把 `svg-to-vue-images/` 底下的 svg 轉成可用的 `<Icon>` vue 元件，輸出到 `svg-to-vue-images-result/`。

| 參數 | 必要 | 說明 |
|---|---|---|
| `scriptLang` | | `'js'` 或 `'ts'`，不給就跳互動選單 |

### `figma-utils.js` / `figmaStuff(options)`

把 Figma 匯出的檔案（`figma-images-folders` 裡面）轉成 `new-images/static` 底下可用的靜態檔案（改檔名 + 分類）。

| 參數 | 必要 | 說明 |
|---|---|---|
| `newImagesFolder` | ✅ | 輸出到這個資料夾的 `static/` 子資料夾 |
| `figmaImagesFolders` | ✅ | 來源，Figma 匯出的原始檔案 |
| `skipConfirm` | | |

沒有 brand 概念（純粹是檔案格式轉換，寫入的是本機的 `new-images`，不動 repo）。

### `full-sync-utils.js` / `fullSyncFromFigma(options)`

**整合指令**：一次檢查 `figma-images-folders` 裡的所有來源檔案（static 圖片 + Logo 元件 + AppIcon + 維護頁 logo + s3 Logo），全部通過才一次寫入 frontend repo 的 static / Logo 元件、s3 repo 的 Logo。

| 參數 | 必要 | 說明 |
|---|---|---|
| `frontendRepoPath` | ✅ | |
| `s3RepoPath` | ✅ | |
| `newImagesFolder` | ✅ | 中間會把來源檔案整理一份到這裡 (`copySourcesToStaging`) |
| `figmaImagesFolders` | ✅ | Figma 匯出的原始檔案，需要齊全（見 `figma-utils.js` 的 `FIGMA_IMAGES` + `logo-svg-format-utils.js` 的 `LOGO_SOURCE_FILE_NAMES` / `APP_ICON_SOURCE_FILE_NAME`） |
| `targetBrand` | | |
| `skipConfirm` | | |

**回傳值**：`{ ok: boolean, reason: string \| null }`。互動選單呼叫端 (`index.js`) 都用 `void` 丟掉回傳值，不受影響；`reason` 是失敗時的簡短原因（缺參數 / brand 沒解析成功 / 來源檔案檢查未過 / 格式尺寸檢查未過 / 使用者取消），給批量呼叫端 (`batchSyncFromFigma`) 判斷成功與否、印報告用。

這是目前**唯一一次到位**的同步指令，其餘的 `staticStuff` / `svgLogoStuff` / `s3LogStuff` 適合單獨修某一塊時用。

### `clean-utils.js` / `cleanLocalFolders(options)`

清空本機的暫存資料夾（`svg-to-vue-images*`、`newImagesFolder`、`figmaImagesFolders`），**不會動到 frontend / s3 repo**。

| 參數 | 必要 | 說明 |
|---|---|---|
| `newImagesFolder` | | 有給才清，沒給跳過 |
| `figmaImagesFolders` | | 同上 |
| `forceClean` | | `true` 跳過兩次確認（此動作無法復原，故意用獨立參數名，不共用 `skipConfirm`） |

### `figma/check-token.js` / `checkFigmaToken(options)`

**Preflight 檢查**：確認 `figma-token` 本身有效（沒過期、沒被撤銷），打的是最輕量的 `GET /v1/me`，不會對任何檔案要求權限、不會動到任何檔案。建議在跑任何 Figma 相關指令之前先跑這個，比等到抓圖跑到一半才發現 token 掛掉快很多。

| 參數 | 必要 | 說明 |
|---|---|---|
| `figmaToken` | ✅ | |

**回傳值**：`{ ok: boolean, reason: string \| null, user: object \| null }`（`user` 是 `/v1/me` 回的帳號資訊，成功時才有值）。

檢查失敗（沒給 token / token 401 過期或被撤銷 / 403 權限不足 / 429 rate limit / 網路錯誤）時，會印出「去哪裡拿 token、放到哪個檔案」的提示（`figma/rest.js` 的 `consoleFigmaTokenSetupHint()`，跟 `setting.json` 沒填 `figma-token` 時印的是同一份）：

```
1. 去 https://www.figma.com/developers/api#access-tokens 產生 personal access token
2. scope 要勾 file_content:read
3. 填進 setting.json 的 "figma-token" (setting.json 已在 .gitignore 裡)
```

### `figma/rest.js` 的 429 重試

Figma personal access token 的 rate limit 是**照帳號算**的（誰產生這顆 token, 用量就算誰的），**不是照 token 算**——換一顆新 token 不會重置額度，Tier 1 端點（`GET /files/:key`、`GET /files/:key/nodes`、`GET /images/:key`，抓圖流程主要都在打這些）額度又特別低（Starter 10/分鐘、Professional 15/分鐘、Organization 20/分鐘）。批量併發跑多個 brand 很容易撞到。

`figmaGet()`（`figma/rest.js` 的內部 helper，所有 `fetch*` 函式都經過這裡）撞到 429 時會自動重試，重試次數用完才真的拋例外失敗。每次重試等待的秒數是 `Math.max(Figma 回的 Retry-After, retryDelaySeconds)`——**不是照 Figma 說的秒數硬等**，因為 Figma 有時候回的 `Retry-After` 只有 1~2 秒，但 rate limit 視窗通常是以分鐘計算，等那麼短幾乎一定還會再撞到，所以 `retryDelaySeconds` 是一個下限，Figma 說的秒數比較長才會用 Figma 的。這條路徑往上一路通到：

```
fetchFigmaAssets(options.maxRetries, options.retryDelaySeconds)
  → run() → fetchAssetPageCandidates / fetchExportAreas / fetchExportAreaTree / fetchImageRefUrls / fetchRenderUrls
      → figmaGet(path, token, { maxRetries, retryDelaySeconds })
```

`pullFromFigma` / `pullAndSyncFromFigma` / `batchSyncFromFigma` 都有 `maxRetries` / `retryDelaySeconds` 這兩個 optional 參數（見上面各自的參數表），不給就用 `figma/rest.js` 匯出的 `DEFAULT_MAX_RETRIES`（目前 3）/ `DEFAULT_RETRY_DELAY_SECONDS`（目前 30 秒）。`index.js` 在這三個選單項目都會先問一次（`askRetryOptions()`）：撞到 429 最多重試幾次、每次至少等幾秒，問在執行前面，跟 `continueOnPartialFetch` 是同一個模式。

### `figma/pull-from-figma.js`

#### `readFigmaToken(settings)`
從 `setting.json` 讀出來的物件裡取 `figma-token`，沒設就印提示、回 `null`。這是給 interface 層在讀完 `setting.json` 後呼叫的，消費端不會拿到 `settings` 物件本身，只會拿到 token 字串。

#### `pullFromFigma(options)`
只做「從 Figma 網址抓圖到 `figma-images-folders`」，不做後續同步。

| 參數 | 必要 | 說明 |
|---|---|---|
| `figmaImagesFolders` | ✅ | 輸出資料夾 |
| `figmaToken` | ✅ | Figma personal access token |
| `figmaUrl` | | 有給就不會再問（`readline` 互動輸入） |
| `clearOutputDir` | | `true`/`false` 決定寫入前要不要先清空輸出資料夾，有給就不會跳互動選單 |
| `maxRetries` | | 撞到 Figma API 的 429 rate limit 時最多重試幾次，不給就用 `figma/rest.js` 的 `DEFAULT_MAX_RETRIES`（目前 3）。見下方「429 重試」 |
| `retryDelaySeconds` | | 每次重試至少等這麼多秒，不給就用 `DEFAULT_RETRY_DELAY_SECONDS`（目前 30）。見下方「429 重試」 |

⚠️ 內部會呼叫 Figma REST API（`fetchFigmaAssets`），批量/併發呼叫時要注意 rate limit。

### `figma/pull-and-sync.js` / `pullAndSyncFromFigma(options)`

**串接**：`pullFromFigma` + `fullSyncFromFigma`。先把 brand 問完/驗證完，再抓圖，抓完直接同步。

| 參數 | 必要 | 說明 |
|---|---|---|
| `frontendRepoPath` | ✅ | |
| `s3RepoPath` | ✅ | |
| `newImagesFolder` | ✅ | |
| `figmaImagesFolders` | ✅ | |
| `figmaToken` | ✅ | |
| `figmaUrl` | | 有給就不會再問 |
| `targetBrand` | | |
| `clearOutputDir` | | 見 `pullFromFigma` |
| `continueOnPartialFetch` | | 抓圖沒有全部成功時要不要繼續往下同步，有給就不會跳互動選單 |
| `skipConfirm` | | 轉給 `fullSyncFromFigma` |
| `maxRetries` | | 撞到 Figma API 的 429 rate limit 時最多重試幾次，轉給 `fetchFigmaAssets`。不給就用預設值 |
| `retryDelaySeconds` | | 每次重試至少等這麼多秒，轉給 `fetchFigmaAssets`。不給就用預設值 |

**回傳值**：`{ ok: boolean, reason: string \| null }`，跟 `fullSyncFromFigma` 同一套。後續同步階段的失敗直接沿用 `fullSyncFromFigma` 的 `reason`；抓圖階段的失敗則是：

- `使用者取消 (沒有 Figma 網址)` / `抓圖階段沒有完成 (使用者取消)`：互動流程中使用者自己按取消。
- `抓圖階段部分失敗, 使用者選擇不繼續同步`：有資產被跳過、且 `continueOnPartialFetch` 決定不繼續。
- `抓圖階段沒有完成: <detail>`：`<detail>` 是 `figma/report.js` 的 `describeFetchFailure()` 組出來的**具體原因**，例如 `Figma API 出錯: Figma API 404 (...)`、`找不到名字含 "asset" 的 page (該檔案的 page: ...)`、`有 2 個 page 都含 "assets-export-area" (...), 無法判斷要用哪一個`、`網址看不懂: ...` 等，不會只印「沒有完成」這種看不出原因的訊息。

這是**目前唯一一個「從 Figma 網址到寫入 repo」全自動的單一入口**，`batchSyncFromFigma`（見下方）就是拿這個當每個 brand 的執行單位。

⚠️ `newImagesFolder` / `figmaImagesFolders` 是**呼叫端決定的路徑**，這個函式本身不會自動避免衝突——多個 brand 併發呼叫且用同一組路徑的話會互相覆蓋彼此的暫存檔案。`batchSyncFromFigma` 是靠幫每個 brand 生成獨立的暫存路徑來解決這個問題，不是靠這個函式本身。

### `figma/batch-sync.js` / `batchSyncFromFigma(options)`

**批量/併發版的 `pullAndSyncFromFigma`**：一次貼多個 `{ targetBrand, figmaUrl }`，每個 brand 各自跑一次「抓圖 + 同步」，彼此失敗互不影響，全部跑完統一印一份成功/失敗報告。

| 參數 | 必要 | 說明 |
|---|---|---|
| `entries` | ✅ | `{ targetBrand: string, figmaUrl: string }[]`。空陣列、項目缺欄位、`targetBrand` 重複都會被擋下來（印紅字、回 `null`，不會執行任何一個 brand） |
| `frontendRepoPath` | ✅ | |
| `s3RepoPath` | ✅ | |
| `figmaToken` | ✅ | 所有 brand 共用同一個 token |
| `concurrency` | | 同時最多幾個 brand 在跑，預設 `3`（Figma API 有 rate limit，別開太大） |
| `clearOutputDir` | | 各 brand 暫存 `figma-images` 資料夾寫入前是否清空，預設 `true`（批量本來就無人值守，沒有人會去回答「要不要清空」） |
| `continueOnPartialFetch` | | 某個 brand 抓圖沒有全部成功時要不要繼續同步那個 brand，預設 `false`（保守，讓那個 brand 停在抓圖階段、不要用不齊的來源硬同步） |
| `tmpRoot` | | 每個 brand 暫存資料夾的根目錄，預設 `'./batch-tmp'`。實際會用到 `${tmpRoot}/${targetBrand}/new-images`、`${tmpRoot}/${targetBrand}/figma-images`，brand 之間互不干擾 |
| `skipConfirm` | | 略過**開始執行前**的確認，直接視為同意。**預設 `false`（會擋）**——因為一旦按下去就是無人值守，會直接覆蓋多個 brand 的 frontend / s3 repo，不像單一 brand 流程中途還有機會喊停 |
| `maxRetries` | | 每個 brand 撞到 Figma API 的 429 rate limit 時最多重試幾次，轉給每個 `pullAndSyncFromFigma`。不給就用預設值。批量併發打 API 比單一 brand 更容易撞到 429，建議明確指定 |
| `retryDelaySeconds` | | 每個 brand 每次重試至少等這麼多秒，轉給每個 `pullAndSyncFromFigma`。不給就用預設值 |

驗證通過後、實際開始併發跑之前，會先印一段前導訊息（`batch-sync.json` 的格式範例、暫存資料夾規則、併發數量、無人值守的警告）+ 完整的 brand/URL 清單，再跳一次確認選單（`skipConfirm` 沒給的話）。使用者選「等等」或選單被取消（例如非 TTY 環境）都會回 `null`，不會執行任何一個 brand。

內部固定用 `skipConfirm: true` 呼叫 `pullAndSyncFromFigma`（外層這一次確認過了，批量情境也沒有人會一個一個盯著每個 brand 再按一次），且 `targetBrand` / `figmaUrl` 都是必填，不會跳 `pickBrand` 或問網址的互動選單。

**回傳值**：`{ results: Array<{targetBrand, ok, reason}>, summary: {succeeded, failed} }`，驗證失敗（`entries` 格式不對、缺參數）回 `null`。

**併發實作**：簡單的 worker pool（`runWithConcurrency`），沒有額外裝套件；`concurrency` 個 worker 各自從佇列裡搶下一個 brand 做，某個 brand 做完了才會撿下一個，不是「開 N 個就等 N 個都做完再開下 N 個」的批次模式。

**`batch-sync.json` 範例**（放在專案根目錄，已加進 `.gitignore`；有現成的 [batch-sync.json.default](./batch-sync.json.default) 可以複製一份改）：

```json
[
  { "targetBrand": "labx", "figmaUrl": "https://www.figma.com/design/xxxxx/labx?node-id=..." },
  { "targetBrand": "btsebt", "figmaUrl": "https://www.figma.com/design/yyyyy/btsebt?node-id=..." }
]
```

`index.js` 選單裡對應「★★ 批量: 一次貼多個 brand + Figma 網址, 併發同步」這個項目，會讀 `setting.json` 的 `frontend-repo-path` / `s3-repo-path` / `figma-token`，加上這個清單檔案，呼叫 `batchSyncFromFigma`。

**`continueOnPartialFetch` 這裡會主動問**：因為批次是併發跑的，沒辦法像單一 brand 的 `pullAndSyncFromFigma` 一樣每個 brand 各自跳出來問一次「還要不要繼續」，所以 `index.js` 會在呼叫 `batchSyncFromFigma` **之前**先問一次（互動選單: 「跳過, 不要往下同步」/「繼續同步, 讓同步階段的來源檔案檢查自己擋」），整批用同一個決定。這個決定也會顯示在批量工具自己印的前導訊息裡。其他直接 import 呼叫 `batchSyncFromFigma` 的腳本要自己決定這個參數的值（不給就是預設 `false`，跳過該 brand）。

---

## 各 function 依賴關係

```
batchSyncFromFigma
 └─ pullAndSyncFromFigma × N (併發, 各自獨立的暫存資料夾)

pullAndSyncFromFigma
 ├─ resolveBrand
 ├─ pullFromFigma 的核心 (runInteractiveFetch / fetchFigmaAssets)
 └─ fullSyncFromFigma
     ├─ resolveBrand
     ├─ figma-utils.checkFigmaImages
     ├─ logo-svg-format-utils.{checkLogoLightAndLogoDark, checkS3Logos, checkAppIcon, checkMaintenanceLogo}
     ├─ static-files-utils.checkStaticImages
     └─ logo-svg-format-utils.{syncLogoLightAndDark, syncAppIcon, syncMaintenanceLogo}

staticStuff / homeAssetsStuff / svgLogoStuff / s3LogStuff / figmaStuff / cleanLocalFolders
 └─ 各自獨立，皆呼叫 resolveBrand（除了 figmaStuff / cleanLocalFolders 沒有 brand 概念）
```
