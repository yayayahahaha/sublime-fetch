# Handoff: 拆成獨立可呼叫 function 的重構

## ⚠️ 先處理這個：憑證外洩

工作過程中不小心把 `setting.json` 的內容印到終端機（含 `figma-token`）。**在繼續看這份文件之前請先：**

1. 到 Figma 後台撤銷/輪替那個 personal access token（Settings → Security → Personal access tokens），換一個新的填回 `setting.json`。
2. 回報給 security@btse.com。

跟下面的程式碼重構本身無關，純粹是操作過程中的意外，但必須先處理掉。

## 目標

把 `index.js` 選單串接的所有功能，從「每個 function 自己讀 `setting.json` + 自己驗證」，改成：

- **Interface 層（`index.js`）**：讀 `setting.json`，做**淺層檢查**（檔案存在、JSON 格式正確、必要欄位有沒有給、型別/路徑格式對不對），再把讀出來的字串值當參數傳給實際做事的 function。
- **消費端（`staticStuff`、`homeAssetsStuff`、`fullSyncFromFigma`... 等）**：不再自己碰 `setting.json`，改成直接收字串參數，並自己做**深層驗證**（例如 `targetBrand` 是否真的存在於 `frontendRepoPath` / `s3RepoPath` 底下）。這樣不管參數是從 `setting.json` 來、互動選單選出來、還是其他 node 腳本直接寫死傳進來，都會經過同一套驗證，不會因為來源不同而漏檢查。

同時把所有原本會卡住的互動式 prompt（確認覆蓋 repo、選 brand、清空資料夾、continue-on-partial-failure...）都加上對應的 override 參數，讓每個 function 都能被其他 node 腳本無人值守呼叫。

## 目前狀態

**程式碼變更已完成，但還沒 commit**（`git status` 顯示 11 個檔案為 modified，工作目錄未清）。語法檢查 (`node --check`) 跟 ESLint 都通過。**還沒有實機跑過完整流程**（找到憑證外洩後就中斷了，沒有繼續用真實 `setting.json` 測試）。

## 改了什麼

### 1. `utils.js`
- `checkSetting()`：移除了「`target-brand` 是否存在於 repo 路徑下」的深層驗證區塊（原本 103-121 行），現在只做淺層檢查（必要欄位存在、型別是字串、路徑格式對）。深層的 brand 存在性驗證移到 `resolveBrand()`。
- 新增 `requireParams(params, keys)`：消費端用來檢查呼叫端傳進來的參數是否為非空字串，防呆用（不管參數來源是 setting.json 還是其他腳本硬寫死）。

### 2. `brand-utils.js`
- `resolveBrand({ targetBrand, frontendRepoPath, s3RepoPath })`：**統一入口**。不管 `targetBrand` 是從 `setting.json` 讀到的還是呼叫端直接傳的，都會驗證它是否真的存在於 `frontendRepoPath`（`brand-${targetBrand}` 資料夾）與 `s3RepoPath`（`${targetBrand}` 資料夾）底下，驗證失敗回 `null`。沒給 `targetBrand` 才會跳互動選單（`pickBrand`），選完一樣會驗證 s3 那邊。
  - 之前的參數名是 `settingBrand`（且不驗證），現在統一叫 `targetBrand`（且一律驗證）。

### 3. 九個消費端 function 的簽名變更

| 檔案 / function | 新簽名（必要參數 + optional override） |
|---|---|
| `static-files-utils.js` / `staticStuff` | `{ frontendRepoPath, newImagesFolder, targetBrand?, skipConfirm? }` |
| `assets-files-utils.js` / `homeAssetsStuff` | `{ frontendRepoPath, newImagesFolder, targetBrand?, selectedImages?, skipConfirm? }` |
| `logo-svg-format-utils.js` / `svgLogoStuff` | `{ frontendRepoPath, newImagesFolder, targetBrand?, skipConfirm? }` |
| `logo-svg-format-utils.js` / `s3LogStuff` | `{ frontendRepoPath, s3RepoPath, newImagesFolder, targetBrand?, skipConfirm? }` |
| `logo-svg-format-utils.js` / `svgToVue` | `{ scriptLang? }`（無需 setting.json） |
| `figma-utils.js` / `figmaStuff` | `{ newImagesFolder, figmaImagesFolders, skipConfirm? }`（沒有 brand 概念） |
| `full-sync-utils.js` / `fullSyncFromFigma` | `{ frontendRepoPath, s3RepoPath, newImagesFolder, figmaImagesFolders, targetBrand?, skipConfirm? }` |
| `clean-utils.js` / `cleanLocalFolders` | `{ newImagesFolder?, figmaImagesFolders?, forceClean? }`（`forceClean` 獨立於 `skipConfirm`，因為這個會真的刪檔案） |
| `figma/pull-from-figma.js` / `pullFromFigma` | `{ figmaImagesFolders, figmaToken, figmaUrl?, clearOutputDir? }`（`clearOutputDir` 獨立參數，因為會真的清空資料夾） |
| `figma/pull-and-sync.js` / `pullAndSyncFromFigma` | `{ frontendRepoPath, s3RepoPath, newImagesFolder, figmaImagesFolders, figmaToken, figmaUrl?, targetBrand?, clearOutputDir?, continueOnPartialFetch?, skipConfirm? }` |

沒有 `?` 的是必要參數（用 `requireParams` 防呆，缺了會印紅字直接 return，不會拋例外）。有 `?` 的是 optional override：不給就維持原本的互動行為（跳選單問使用者），給了就直接用那個值、不會再問。

`readFigmaToken(settings)` 維持不變，仍是「給 interface 層讀完 `setting.json` 後呼叫」的工具函式，從 `figma/pull-from-figma.js` export。

### 4. `index.js`
- 新增 `loadSettings(requiredKeys)`：interface 層的入口，讀 `setting.json` + 呼叫 `checkSetting()` 做淺層檢查，回傳 `{ ...checked, raw: settings }`（`raw` 是原始物件，給需要 `figma-token` 的 case 用）。
- 每個 `case` 都改成：呼叫 `loadSettings([...])` 拿到需要的欄位 → 組成參數物件 → 傳給對應的 function。互動流程（選單本身）完全沒變，使用者體感應該是一致的。

## 待辦 / 建議下一步

1. **先處理上面那個憑證外洩**（撤銷 token + 回報）。
2. **實機驗證**：換了新 token 之後，跑一次 `node index.js`，把選單裡每一項都跑一遍（至少跑到「檢查完畢，即將覆蓋...」那個確認步驟前，不用真的按確認），確認 interface 層抽參數、往下傳沒有漏東西或打錯 key。特別注意：
   - `S3_LOGO` case 有沒有把 `frontendRepoPath` 也傳進去（`s3LogStuff` 需要它來驗證 brand 在 frontend 那邊也存在）。
   - `pullAndSyncFromFigma` 最後呼叫 `fullSyncFromFigma` 時有沒有把 `newImagesFolder` / `figmaImagesFolders` 也轉發過去。
3. **寫個小 smoke test 腳本**驗證「被其他 node 檔案呼叫」這個目標真的成立：新建一個 scratch 的 `.js` 檔案，`import` 這些 function、帶入寫死的參數（不透過 `index.js`/`setting.json`），確認能跑到底不會卡在任何 prompt。
4. 確認沒問題後 commit（目前完全沒有 commit 過任何東西）。
