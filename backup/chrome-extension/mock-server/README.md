# Mock Server

在本地攔截前端的 API / WebSocket 請求：**命中你寫的 mock 就回你設定的內容，沒命中的一律 proxy 到真實後端**。用來在真後端還沒好、或想模擬特定情境（大 payload、錯誤碼、特定欄位值、行情推送）時開發前端。

前端只要把 API base URL / WS URL 指到 `http://localhost:3000`（預設 port），其餘照舊。

---

## 快速開始

### 啟動

透過 t99 主選單：

```
my_alias  →  選「Mock Server 啟動有 mock api 的 server」
```

會依序問你四件事：

| 問題 | 說明 |
| --- | --- |
| `default-api-domain` | 沒被 mock 命中的請求 proxy 去哪（有歷史紀錄可選）|
| 是否顯示 proxy 的 log | mock 命中一律印；proxy（沒命中）的 log 預設不印，開這個才印 |
| `ws-domain` | tamper 與沒被 mock 的 ws upgrade 轉發去哪。可選「🚫 不啟用」（純 mock 的 ws 仍可用）|
| 是否啟用 hot reload | 預設 yes，見下 |

啟動後前端把請求打到 `http://localhost:3000` 即可。

### 直接跑（跳過選單）

```bash
MOCK_DEFAULT_API_DOMAIN=https://xxx-api.btse.co \
MOCK_WS_DOMAIN=wss://ws.xxx.btse.io \
MOCK_SHOW_BYPASS=0 \
node mock-server/run.js
```

---

## Hot reload

啟用後，server 跑在一個 **child process**，`mock-server/` 底下的檔案一有異動就自動 kill 掉重開（fresh process，任何 mock / route / ws 改動都保證生效）——不用手動重啟。

- 為什麼要重啟整個 process：ESM 的 module 一旦載入就被 cache，且 Express 路由、ws server 都是啟動時綁定的，沒有乾淨的 in-process 熱替換方式。重開新 process 是唯一保證正確的做法。
- 存壞某個 mock 檔導致 server crash 時，它會**停著**等你修好再存檔觸發重開（不會瘋狂 respawn）。
- `Ctrl+C` 會一併收掉 child，不留佔 port 的孤兒 process。
- 選 no 則走 in-process 模式，改動需手動重啟。

---

## 四種 mock 方式

不管 HTTP 還是 WebSocket，都有「全取代」和「proxy 真後端後 modify」兩種：

| | 全取代（自己生整包回應）| proxy 真後端後 modify（拿真資料改幾個欄位）|
| --- | --- | --- |
| **HTTP** (`mocks/*.js`) | `respond(label, payload)` | `tamper(defaultApiDomain, { label, modify })` |
| **WebSocket** (`ws/mocks/*.js`) | `mode: 'mock'` | `mode: 'tamper'` |

原則：能用真資料就別整包假造（payload 大、前端到處在讀，整包造假更容易壞）。只想動一兩個欄位就用 tamper。

---

## 怎麼加一個 HTTP mock

每個檔案是一個 domain / 功能，`export default function register(app, { defaultApiDomain })`。寫完 → 在 `server.js` 頂部 import → 在 register 區塊呼叫。

### (1) 全取代：`respond`

```js
// mocks/my-feature.js
import { respond } from './_helpers.js'

export default function register(app) {
  app.get('/api/my/thing', respond('my-thing', {
    code: 1, msg: 'Success', data: { hello: 'world' }, success: true,
  }))
}
```

錯誤碼情境：payload 帶 `_httpStatus`，`respond` 會用它當 HTTP status：

```js
app.get('/api/my/thing', respond('my-thing FAIL', {
  _httpStatus: 400,
  body: { code: 0, msg: 'BADREQUEST', data: null, success: false },
}))
```

### (2) proxy 真後端後 modify：`tamper`

`tamper` 是**格式無關**的：把真後端回來的原始回應（utf8 文字，binary 用 `ctx.buffer`）交給你，你回傳 string / Buffer 就送那個、回傳 `undefined` 就原樣放行。JSON / HTML / 純文字都能改。

JSON 情境搭配 `asJson`（幫你 parse / stringify、非 JSON 自動放行）：

```js
// mocks/my-patch.js
import { tamper, asJson } from './_helpers.js'

export default function register(app, { defaultApiDomain }) {
  app.use('/api/user/account', tamper(defaultApiDomain, {
    label: 'user/account',
    modify: asJson((body) => {
      if (body?.data) body.data.referralIdentity = 'premium' // 就地改
    }),
  }))
}
```

非 JSON（例如改 HTML）就不用 `asJson`，直接操作文字：

```js
modify: (text) => text.replace('REAL', 'TAMPERED')
```

`modify(text, ctx)` 的 `ctx` 有 `{ req, res, proxyRes, status, buffer }`；`modify` 丟錯會自動原樣放行，不弄斷真資料流。想要更細的 log 標籤可在 `modify` 裡自己寫 `res.locals._mockLabel`。

### (3) 大 payload 放資料檔

回應很大時，把 JSON 存成獨立檔、handler 每次 request 重讀（改 json 免重啟，即使沒開 hot reload）：

```js
// mocks/init-wallet.js  → 讀 mocks/data/init-wallet.json
```

參考現有的 `mocks/init-wallet.js`。

### 註冊（`server.js`）

```js
import registerMyFeature from './mocks/my-feature.js'
// ...
registerMyFeature(app, { defaultApiDomain })
```

> 所有 register 都收 `{ defaultApiDomain }`（server.js 已統一傳入）；用不到就忽略。

---

## 怎麼加一個 WebSocket mock

每個檔案 export 一個宣告物件，寫完 → 在 `ws/router.js` 頂部 import → 加進 `WS_MOCKS` 陣列。路由依 `path` 分流：被認領的歸 mock 管，沒認領的 proxy 到 ws-domain。

### (1) 全取代：`mode: 'mock'`（用 `createFeedMock`）

宣告哪些 topic、多久推一次、資料長怎樣。訂閱協議（`{op:'subscribe',args}` → ack `{event,channel}`）和 timer 生命週期都由框架包掉。

```js
// ws/mocks/my-feed.js
import { createFeedMock } from '../feed-mock.js'

export default createFeedMock({
  path: '/ws/my-feed',
  topics: {
    orderbook: {
      intervalMs: 100,                       // 高頻就調小
      make: (i) => ({ topic: 'orderbook', data: { seq: i } }), // i = 第幾個 tick
    },
  },
})
```

不需要 ws-domain 也能跑（純本地假資料）。

### (2) proxy 真後端後 modify：`mode: 'tamper'`

中間人轉發到真後端（ws-domain），用 hook 動手腳。沒定義的 hook = 原樣轉發：

```js
// ws/mocks/my-tamper.js
export default {
  path: '/ws/my-tamper',
  mode: 'tamper',
  // upstreamDomain: 'wss://...',  // 想固定連別的 domain 才需要，預設用啟動時的 ws-domain

  onUpstreamMessage(raw, ctx) {   // 下行（真後端 → 前端）
    const msg = JSON.parse(raw)
    if (msg.topic === 'wallet') { msg.data.balance = '999999'; return JSON.stringify(msg) }
    return raw          // 原樣放行
    // return null       // 吞掉這一幀（模擬掉訊息）
    // ctx.sendToClient(x) / ctx.sendUpstream(x) 可額外插幀
  },
  // onClientMessage(raw, ctx) {...}  // 上行（前端 → 真後端），可攔 subscribe 改參數
}
```

tamper 需要 ws-domain（或宣告 `upstreamDomain`）；啟動時選「🚫 不啟用 WS 轉發」的話 tamper mock 會被停用並警告，但 `mode: 'mock'` 不受影響。

### 註冊（`ws/router.js`）

```js
import myFeed from './mocks/my-feed.js'
const WS_MOCKS = [demoFeed, demoTamper, myFeed]
```

> 同一個 `path` 只能有一種身分，重複認領啟動時會直接報錯。

---

## 怎麼測

- **HTTP**：`curl http://localhost:3000/api/my/thing`，或直接讓前端指過來。
- **WebSocket**：用內建的探針 client（不用開前端）：

  ```bash
  node mock-server/ws/examples/demo-client.js         # 連 /ws/demo-feed，port 預設 3000
  ```

  它會 subscribe、印出收到的推送、示範 unsubscribe。改一下裡面的 URL / topic 就能拿去測自己的 ws mock。也可以用 `wscat -c ws://localhost:3000/ws/xxx` 手動連。
- **log**：mock 命中會印 `[mock:label ...]`；ws 透傳幀每秒彙總一行。

---

## 檔案結構

```
mock-server/
  index.js            啟動選單（問設定）+ hot reload 的 fork/watch launcher
  run.js              被 fork 的薄 entry（從 env 讀設定起 server）
  server.js           建 express app、掛 HTTP mock、catch-all proxy、掛 ws router
  log-utils.js        共用 log helpers
  domain-history.js   api / ws domain 的歷史紀錄（存在 ../cache）
  mocks/
    _helpers.js       respond（全取代）、tamper + asJson（proxy 後改）
    *.js              各 HTTP mock（export default register）
    data/*.json       大 payload 資料檔
  ws/
    router.js         upgrade 路由：WS_MOCKS 分流 + catch-all ws proxy
    feed-mock.js      createFeedMock（mode: 'mock' 框架）
    tamper.js         mode: 'tamper' 的中間人配對邏輯
    mocks/*.js        各 ws mock（宣告物件）
    examples/demo-client.js  測試用探針 client
```
