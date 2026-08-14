# Mock Server

在本地攔截前端的 API / WebSocket 請求：**命中你寫的 mock 就回你設定的內容，沒命中的一律 proxy 到真實後端**。用來在真後端還沒好、或想模擬特定情境（大 payload、錯誤碼、特定欄位值、行情推送）時開發前端。

前端只要把 API base URL / WS URL 指到 `http://localhost:<port>`（啟動時選，預設 3000），其餘照舊。同時想跑多個（各自 mock 不同東西）就開多個、各給不同 port，見下面「同時跑多個」。

---

## 快速開始

### 啟動

透過 t99 主選單：

```
my_alias  →  選「Mock Server 啟動有 mock api 的 server」
```

會依序問你幾件事：

| 問題 | 說明 |
| --- | --- |
| `default-api-domain` | 沒被 mock 命中的請求 proxy 去哪（有歷史紀錄可選）|
| `port` | server 監聽哪個 port（預設 3000）。會即時檢查是否被占用，被占用就要你換一個 |
| 要載入哪些 HTTP mock | 多選（空白鍵勾選，**預設全選**）；只有勾到的才掛上，其餘端點走 proxy |
| 要載入哪些 WS mock | 多選（同上，預設全選）；WS mock 也是自動掃描的 |
| 是否顯示 proxy 的 log | mock 命中一律印；proxy（沒命中）的 log 預設不印，開這個才印 |
| `ws-domain` | tamper 與沒被 mock 的 ws upgrade 轉發去哪。可選「🚫 不啟用」（純 mock 的 ws 仍可用）|
| 是否啟用 hot reload | 預設 yes，見下 |

啟動後前端把請求打到 `http://localhost:<剛選的 port>` 即可。

### 直接跑（跳過選單）

```bash
MOCK_DEFAULT_API_DOMAIN=https://xxx-api.btse.co \
MOCK_PORT=3000 \
MOCK_MODULES=affiliate,chart-markets-list \    # HTTP mock 模組名，逗號分隔；不設 = 全部、空字串 = 都不載入
MOCK_WS_MODULES=demo-feed \                    # WS mock 名，規則同上
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
- 開多個 instance 時，每個 instance 各自有一個 watcher 盯著 `mock-server/`，所以改任何一個檔，**所有正在跑的 instance 都會各自重啟**（就算某個 instance 沒載入你改的那支也會一起重啟，無害）。

---

## 同時跑多個 mock server（用模組多選區分 response）

需要「不同的 server 回不同東西」時，開多個 instance、各給不同 port、各自勾不同模組即可：

- **不同端點**：instance A 勾 `[affiliate, chart-markets-list]`、instance B 勾 `[assessment-test]` → 各自只 mock 自己那些，其餘走 proxy。
- **同一個端點、不同資料**：做兩個模組（例如 `account-1.js` / `account-2.js`，各自宣告同一條 `/api/user/account` 但回不同內容），每個 instance 只勾其中一個。
  - ⚠️ 同一個 instance 若不小心把兩個都勾了（同一條 route 被兩個模組宣告），啟動時會**直接報路徑衝突錯誤**，不會靜默地讓其中一個蓋掉另一個。

每個模組是獨立的 process，狀態互不干擾（例如 `assessment-test` 的計分狀態，A、B instance 各自獨立）。

---

## 四種 mock 方式

不管 HTTP 還是 WebSocket，都有「全取代」和「proxy 真後端後 modify」兩種：

| | 全取代（自己生整包回應）| proxy 真後端後 modify（拿真資料改幾個欄位）|
| --- | --- | --- |
| **HTTP** (`mocks/*.js`) | `respond(label, payload)` | `tamper(defaultApiDomain, { label, modify })` |
| **WebSocket** (`ws/mocks/*.js`) | `mode: 'mock'` | `mode: 'tamper'` |

原則：能用真資料就別整包假造（payload 大、前端到處在讀，整包造假更容易壞）。只想動一兩個欄位就用 tamper。

---

## 用產生器新增（推薦，不用複製 JS）

t99 的「Mock Server」進去後有三個選項：**啟動 mock server** / **新增 Mock API（HTTP）** / **新增 Mock WS**。後兩個是產生器，回答幾個問題就好，不用手 copy 檔案。

分工：**「自己生資料」的走宣告式（純資料檔，改檔即改）；「proxy 後改」因為要寫邏輯，吐一支 `.js` 骨架讓你填。**

| | 產生什麼 | 你要做的 |
| --- | --- | --- |
| HTTP · respond | append 進 `mocks/<module>.mock.json` + 建 response JSON 檔 | 去填 response JSON |
| HTTP · tamper | 產生 `mocks/<name>.js`（`modify` 留白 + `return body`）| 改「✏️ 改這裡」那行 |
| WS · feed | append 進 `ws/mocks/<module>.ws.json` + 建 payload JSON 檔 | 去填 payload JSON |
| WS · tamper | 產生 `ws/mocks/<name>.js`（`onUpstreamMessage` 留白 + `return raw`）| 改「✏️ 改這裡」那行 |

**新增 Mock API（HTTP）** 問：mode（respond / tamper）→ method → path →（respond 再問要加到哪個 `.mock.json` 模組 / 新模組、response 檔路徑）。

**新增 Mock WS** 問：mode（feed / tamper）→（feed 問要加到哪個 `.ws.json` feed 模組 / 新模組 + path、topic 名、`intervalMs`、payload 檔路徑；tamper 問模組名 + path）。

宣告式格式（`intervalMs`、`payloadFile`、`responseFile` 都是**每次被呼叫 / 每 tick 重讀**，改 JSON 即時生效）：

```jsonc
// mocks/<module>.mock.json（HTTP respond）
{ "routes": [ { "method": "GET", "path": "/api/my/thing", "mode": "respond", "responseFile": "data/my-thing.json" } ] }

// ws/mocks/<module>.ws.json（WS feed）
{ "path": "/ws/my-feed", "mode": "mock",
  "topics": { "systemEvent": { "intervalMs": 3000, "payloadFile": "data/my-feed-systemEvent.json" } } }
```

產生完存檔即被自動掃到、出現在啟動多選；不用改 `server.js` / `ws/router.js`。需要動態資料（seq 遞增、價格模擬、依 request/subscribe 變）時，宣告式表達不了 → 用下面的「手寫」方式。

---

## 手寫一個 HTTP mock

每個檔案是一個 domain / 功能，`export default function register(app, { defaultApiDomain })`。**在 `mocks/` 丟一個檔就好**——server 啟動時會自動掃 `mocks/*.js`（跳過 `_` 開頭的共用檔），新模組會自動出現在啟動時的「要載入哪些模組」多選清單裡。**不用**再回 `server.js` 補 import。模組名就是檔名（去 `.js`）。

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

參考現有的 `mocks/init-wallet.js` 和 `mocks/chart-markets-list.js`。

### 就這樣，不用註冊

丟進 `mocks/` 後就會被自動掃到、出現在啟動多選清單。所有模組都收 `{ defaultApiDomain }`（用不到就忽略）。要暫時停用某個模組，啟動時取消勾選即可，不用改碼。HTTP 和 WS 都是自動掃描的（見下）。

---

## 手寫一個 WebSocket mock

`ws/mocks/` 也是**自動掃描**的（跟 HTTP 一樣）：丟一個 `.js`（export default 一個 WS mock 物件）或 `.ws.json`（宣告式 feed）就會被掃到、出現在啟動的 WS mock 多選裡，**不用**回 `ws/router.js` 註冊。名字 = 檔名去副檔名。路由依 `path` 分流：被認領的歸 mock 管，沒認領的 proxy 到 ws-domain。

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

> 丟進 `ws/mocks/` 即自動掃到、進啟動多選，不用註冊。同一個 `path` 只能有一種身分，重複認領啟動時會直接報錯。動態 feed（`make(i)` 用 tick 序號做遞增 / 波動）就用上面 `createFeedMock` 手寫；靜態 / 改檔即變的用產生器吐的 `.ws.json`。

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
  index.js            啟動選單（Mock Server：啟動 / 新增 Mock API / 新增 Mock WS）+ 啟動問設定 + hot reload 的 fork/watch launcher
  run.js              被 fork 的薄 entry（從 env 讀設定起 server）
  server.js           建 express app、載入選到的 HTTP + WS mock、catch-all proxy、掛 ws router
  load-mocks.js       掃 mocks/（.js + .mock.json）、載入選到的、掛載 + 跨模組路徑衝突偵測
  scaffold.js         「新增 Mock API / WS」產生器（寫 .mock.json / .ws.json，或吐 tamper .js 骨架）
  log-utils.js        共用 log helpers
  domain-history.js   api / ws domain 的歷史紀錄（存在 ../cache）
  mocks/
    _helpers.js       respond、tamper + asJson、buildDeclarativeRegister；_ 開頭 = 不會被當成 mock 掃到
    *.js              手寫 HTTP mock（export default register）→ 丟檔即自動被掃到
    *.mock.json       宣告式 HTTP mock（respond；產生器寫的）→ 同樣自動被掃到
    data/*.json       response / 大 payload 資料檔
  ws/
    router.js         upgrade 路由：依傳入的 wsMocks 分流 + catch-all ws proxy
    load-ws-mocks.js  掃 ws/mocks/（.js + .ws.json）、載入選到的 WS mock
    feed-mock.js      createFeedMock（mode:'mock' 框架）+ buildDeclarativeFeed（.ws.json）
    tamper.js         mode: 'tamper' 的中間人配對邏輯
    mocks/*.js        手寫 ws mock（宣告物件）；*.ws.json 宣告式 feed；data/*.json payload
    examples/demo-client.js  測試用探針 client
```
