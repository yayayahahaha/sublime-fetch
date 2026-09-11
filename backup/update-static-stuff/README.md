# 創建/修改一個白牌的時候可以用的工具

> 大部分還是需要手動就是了

## 環境

| Application | Version |
| ----------- | ------- |
| Nodejs      | 18^     |

## 怎麼用

```bash
# 安裝 pacakges
pnpm install

node index.js
```

接著照著跳出來的提示處理想做的事情即可

> 每個選單項目背後實際做事的 function 都可以被其他 node 腳本直接 import 呼叫（不透過這個互動選單），
> 參數 / 驗證規則說明見 [FUNCTIONS.md](./FUNCTIONS.md)。

## 處理細節

#### 我想要看白牌要調整的項目的清單

列出各種需要留意的地方，但可能還是沒辦法齊全

#### 檢查 Figma token 是否可用 (preflight)

只打最輕量的 Figma API (`/v1/me`) 確認 `setting.json` 裡的 `figma-token` 還有效，不會動到任何檔案。建議在跑任何 Figma 相關指令（單一 brand 或批量）之前先跑一次，檢查失敗會告訴你去哪裡重新產生 token、要填到哪個檔案的哪個欄位。

#### ★★ 批量: 一次貼多個 brand + Figma 網址, 併發同步

一次處理多個白牌: 複製一份 [batch-sync.json.default](./batch-sync.json.default) 改成 `batch-sync.json`（已加進 `.gitignore`，跟 `setting.json` 一樣是自己機器上的清單，不用共用/commit）:

```bash
cp batch-sync.json.default batch-sync.json
```

內容是一個陣列，每個項目對應一個要處理的 brand:

```json
[
  { "targetBrand": "labx", "figmaUrl": "https://www.figma.com/design/xxxxx/labx?node-id=..." },
  { "targetBrand": "btsebt", "figmaUrl": "https://www.figma.com/design/yyyyy/btsebt?node-id=..." }
]
```

選這個選單項目會讀 `setting.json` 的 `frontend-repo-path` / `s3-repo-path` / `figma-token`，加上這份清單，先問兩個問題（整批統一套用，不會每個 brand 各問一次）：

1. 某個 brand 抓圖沒有全部成功時要跳過還是繼續同步
2. 撞到 Figma API 的 429 rate limit 時最多重試幾次、每次至少等幾秒

回答完會印一份前導訊息（清單、會改動的 repo 路徑等）再跳最後一次確認。確認之後就是**無人值守**了，每個 brand 用**獨立的暫存資料夾**併發跑「抓圖 + 同步」（預設同時最多 3 個，避免打爆 Figma API），彼此失敗互不影響，全部跑完會印一份成功/失敗的總結報告（失敗會帶具體原因，不會只印「沒有完成」）。

執行前務必先確認 `batch-sync.json` 裡的 brand / 網址都對，且對應的 frontend / s3 repo 都已經清空 git status。

**關於 Figma rate limit**：personal access token 的額度是**照帳號算的，不是照 token 算**，撞到 429 換一顆新 token 沒有用，只能等、降低併發、或升級 plan。撞到 429 時會自動重試，每次等待的秒數是「Figma 回的秒數」跟「你設定的最少等待秒數」取較大值——Figma 有時候只回 1~2 秒，但 rate limit 視窗通常以分鐘計算，等那麼短基本上一定還會再撞到，所以有這個下限可以設（預設 30 秒，常常撞到可以拉到 60、120 秒）。批量併發打 API 比單一 brand 更容易撞到，也可以考慮把 `batchSyncFromFigma` 的 `concurrency` 調低。

#### 同步 assets 相關的檔案

首頁相關的那些  
![home-hints](./hint-images/home-hints.png)

#### 同步 LogoLight 和 LogoDark

SVG 的部分，會調整成可用的 .vue 的形式, 使用的 template 在 [LOGO_TEMPLATE.txt](./LOGO_TEMPLATE.txt) `

#### 同步 S3 那裡的 LogoLight 和 LogoDark

S3 Logo 的部分, 不含其它如 referral, task-and-reward 等等

#### 將從 figma 上載下來的檔案直接轉換到 new-images/static 資料夾中

解壓縮相關的檔案到指定路徑，就可以動態產稱可用的 static 靜態檔案  
![figma-images-replace](./hint-images/figma-images-place.png)

#### 同步 static 相關的靜態檔案

各種尺寸的 logo, 像是 PWA 和 favicon 等等

## TODO

1. btse-s3 那個 repo 的其他各種圖片上傳 (referral 的 banner(login/out), lighten...), email, task-and-rewrard 等等

   > 可以用 checkbox

2. email 那個 repo 的各種檔案的上傳自動化(包含 Logo) 如果有的話

3. 傳入 figma 網頁，自動取出相對應的圖片等等
