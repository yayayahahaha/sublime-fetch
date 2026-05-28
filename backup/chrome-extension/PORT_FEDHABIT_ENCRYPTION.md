# 把 FedHabit 的 ECDH+AES-GCM 加密邏輯移植到 chrome-extension/auto-login

> 這是一份 handoff 文件。請在 `/Users/flyc.chung/btse/chrome-extension` 開新的 Claude Code session，把此檔丟進去當參考。

## 0. 來源 repo 簡述（FedHabit 在做什麼）

FedHabit brand 在 frontend repo (`/Users/flyc.chung/btse/ww`) 啟用了一層 **transport 加密**：

- **觸發旗標**：`src/brand-fedhabit/generalConfig.js:117` 的 `enableApiEncryption: true`
- **加密實作**：`src/utils/encryptEcdhAesGcm.ts`（瀏覽器原生 Web Crypto API）
- **流程**：
  1. 應用啟動後第一次需要加密時，呼叫 `GET {apiBaseUrl}/api/init` 拿伺服器的 ECDH 公鑰（PEM 內容字串）。
  2. 用客戶端固定的 ECDH 私鑰（環境變數 `VUE_APP_CLIENT_PEM`）+ 伺服器公鑰跑 ECDH（曲線 `P-256`）派生 shared secret。
  3. SHA-256 雜湊 shared secret，import 為 AES-256 key。
  4. 之後每個 request body 用 AES-GCM（12-byte 隨機 IV）加密成 `{ iv, message }` 兩個 base64 欄位。
  5. Response 裡如果 `data.iv` 與 `data.message` 同時存在，就用同一把 key 解密回原本的 JSON。
- **適用範圍**：登入、Device OTP、2FA、所有走 ApiInstance 的端點都套同一層，端點路徑與其他 brand 完全相同，差別只在 body 加密。

**目標**：把這層加密加到 `chrome-extension/auto-login/` 的終端腳本，讓需要登入 FedHabit 環境時也能跑通。是否啟用以「brand name allowlist」決定（手動維護的清單）。

---

## 1. 目前 chrome-extension/auto-login 的關鍵結構

| 檔案 | 角色 |
|---|---|
| `auto-login/t99.js` | CLI 進入點（inquirer prompt → 選 profile → 跑 login） |
| `auto-login/login-stuff.js` | **核心**。`LoginNeeded` class 包含 `loginApi`、`resendOtp`、`finalPass`、`getCaptchaImage`、`checkTokenHealth` 等所有 API 呼叫 |
| `auto-login/request-stuff.js` | 薄薄的 fetch 包裝（`get` / `post` / `Response`） |
| `auto-login/settings-loader.js` | 讀 `settings.json`（git-ignored 的本機設定） |
| `settings.json` | 含 `loginProfiles[]`、`brand-list`、`redis` 等 |

`login-stuff.js` 中目前的 API 呼叫位置（要改的就這幾處）：

| Method | 目前實作行數 | Body 格式 | 備註 |
|---|---|---|---|
| `loginApi(loginParams)` | 181-195 | `FormData`（multipart） | 主要登入 |
| `resendOtp(token)` | 197-208 | `URLSearchParams` 字串（form-urlencoded） | Device OTP 重寄 |
| `finalPass({...})` | 260-275 | `URLSearchParams` 字串 | 2FA / Device 最終驗證 |
| `getCaptchaImage()` | 230-233 | GET | 拿圖 |
| `checkTokenHealth(token)` | 277-301 | GET（帶 Bearer） | 健康檢查 |

**每個方法的回傳格式都是** `{ error, data }`（來自 `request-stuff.js` 的 `Response`），**呼叫端讀取的常見欄位是 `response.data.data.<x>`**（因為 backend 包了一層 `{ success, data: { ... } }`）。維持這個 shape，呼叫端就完全不用改。

---

## 2. 動工清單（兩個新檔 + 一個改動）

1. **新增** `auto-login/encrypt-ecdh-aes-gcm.js`：Node 版本的加密工具
2. **新增** `auto-login/encryption-config.js`：brand allowlist + 從 settings.json 讀 client PEM
3. **修改** `auto-login/login-stuff.js`：加 `_encryptedPost` / `_encryptedGet` 私有方法，並在五個 API 方法的進入點分流
4. **更新** `settings.json` schema（README 也要補一段）

---

## 3. 新檔：`auto-login/encrypt-ecdh-aes-gcm.js`

> Node 19+ 才有 `globalThis.crypto.subtle`。專案目前沒釘 `engines`，請在新 session 確認 `node -v >= 20`，舊版要嘛升級要嘛換用 `node:crypto` 的 `subtle`（`import { webcrypto } from 'node:crypto'`）。

```js
// auto-login/encrypt-ecdh-aes-gcm.js
//
// 對應 frontend repo: /Users/flyc.chung/btse/ww/src/utils/encryptEcdhAesGcm.ts
// 演算法：ECDH (P-256) → SHA-256(sharedSecret) → AES-GCM-256 key
// Body 格式：{ iv: base64, message: base64 }（兩者都是 base64-encoded）

import { Buffer } from 'node:buffer'
import { get } from './request-stuff.js'

// 每個 brand 一把 cached AES key（不同 brand 連到的 server 不同 → 公鑰不同）
const aesKeyPromiseByBrand = new Map()

// PEM 可能是 "raw base64" 或帶有 -----BEGIN/END----- 標頭的完整 PEM。
// FedHabit 的 .env 是 raw base64；伺服器回的可能也是。兩種都接。
function pemToArrayBuffer(pem) {
  const base64 = pem
    .replace(/-----BEGIN [A-Z0-9 ]+-----/g, '')
    .replace(/-----END [A-Z0-9 ]+-----/g, '')
    .replace(/\s+/g, '')
  const buf = Buffer.from(base64, 'base64')
  // 回傳 Uint8Array (subtle.importKey 接受 BufferSource)
  return new Uint8Array(buf)
}

function base64ToUint8Array(base64) {
  if (typeof base64 !== 'string') {
    throw new TypeError('base64 input must be a string')
  }
  let s = base64.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4 !== 0) s += '='
  return new Uint8Array(Buffer.from(s, 'base64'))
}

function uint8ArrayToBase64(bytes) {
  return Buffer.from(bytes).toString('base64')
}

function getParsedData(text) {
  if (typeof text !== 'string' || text.trim().length < 2) return text
  const t = text.trim()
  const looksJson = (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))
  if (!looksJson) return text
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function toPlaintext(data) {
  if (data !== null && typeof data === 'object') return JSON.stringify(data)
  return data
}

async function importPrivateKey(pem) {
  const keyData = pemToArrayBuffer(pem)
  return crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey', 'deriveBits'],
  )
}

async function importPublicKey(pem) {
  const keyData = pemToArrayBuffer(pem)
  return crypto.subtle.importKey(
    'spki',
    keyData,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
}

async function deriveSharedAesKey(privateKey, peerPublicKey) {
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    256,
  )
  const hashedSecret = await crypto.subtle.digest('SHA-256', sharedSecret)
  return crypto.subtle.importKey(
    'raw',
    hashedSecret,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptAesGcm(key, data) {
  const plaintext = toPlaintext(data)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  return {
    ciphertext: uint8ArrayToBase64(new Uint8Array(ciphertext)),
    iv: uint8ArrayToBase64(iv),
  }
}

export async function decryptAesGcm(key, ciphertextBase64, ivBase64) {
  const ciphertext = base64ToUint8Array(ciphertextBase64)
  const iv = base64ToUint8Array(ivBase64)
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    ciphertext,
  )
  return getParsedData(new TextDecoder().decode(decrypted))
}

// 由呼叫端傳入：apiBaseUrl + clientPem (該 brand 對應的客戶端私鑰)
async function generateAesKey({ apiBaseUrl, clientPem }) {
  // GET /api/init → 伺服器公鑰 PEM
  // 注意：對應 frontend `Api.getKeys()`，response shape 為 `{ success, data: <pemString> }`
  // 請在新 session 用 curl 驗證實際 shape；若不同，調整下面這一行
  const initRes = await get(`${apiBaseUrl}/api/init`)
  if (initRes.error) throw new Error(`/api/init failed: ${JSON.stringify(initRes.error)}`)
  const serverPublicPem = initRes.data?.data ?? initRes.data
  if (!serverPublicPem || typeof serverPublicPem !== 'string') {
    throw new Error(`/api/init 沒有拿到有效的公鑰 PEM, got: ${JSON.stringify(initRes.data)}`)
  }

  const clientPrivateKey = await importPrivateKey(clientPem)
  const serverPublicKey = await importPublicKey(serverPublicPem)
  return deriveSharedAesKey(clientPrivateKey, serverPublicKey)
}

export function getAesKeyForBrand(brandName, { apiBaseUrl, clientPem }) {
  if (!aesKeyPromiseByBrand.has(brandName)) {
    aesKeyPromiseByBrand.set(
      brandName,
      generateAesKey({ apiBaseUrl, clientPem }).catch((err) => {
        // 失敗時清掉 cache，下次重試
        aesKeyPromiseByBrand.delete(brandName)
        throw err
      }),
    )
  }
  return aesKeyPromiseByBrand.get(brandName)
}

// 給呼叫端用的便利方法：把整包 response 解密回原樣
export async function decryptResponseInPlace(aesKey, response) {
  const iv = response?.data?.data?.iv
  const message = response?.data?.data?.message
  if (iv && message && aesKey) {
    try {
      response.data.data = await decryptAesGcm(aesKey, message, iv)
    } catch (err) {
      console.error('decryptResponseInPlace failed:', err)
    }
  }
  return response
}
```

---

## 4. 新檔：`auto-login/encryption-config.js`

```js
// auto-login/encryption-config.js
//
// 手動維護「需要加密的 brand」清單 + 從 settings.json 讀對應的 client PEM。
// 之後若有新的 brand 啟用 transport 加密，加進 BRANDS_NEED_ENCRYPTION 即可。

import { loadSettings } from './settings-loader.js'

export const BRANDS_NEED_ENCRYPTION = ['fedhabit']

export function brandNeedsEncryption(brandName) {
  return BRANDS_NEED_ENCRYPTION.includes(brandName)
}

// settings.json 新增的欄位 shape:
// {
//   "encryption": {
//     "fedhabit": {
//       "clientPem": "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEH..."  // 同 frontend repo `.env.fedhabit` 裡的 VUE_APP_CLIENT_PEM
//     }
//   }
// }
export function getClientPemForBrand(brandName) {
  const settings = loadSettings()
  const pem = settings?.encryption?.[brandName]?.clientPem
  if (!pem) {
    throw new Error(
      `[encryption-config] 找不到 brand "${brandName}" 的 clientPem，` +
        `請在 settings.json 補上 encryption.${brandName}.clientPem ` +
        `（值同 frontend .env.${brandName} 裡的 VUE_APP_CLIENT_PEM）`,
    )
  }
  return pem
}
```

---

## 5. 修改 `auto-login/login-stuff.js`

### 5.1 import 區塊

最上方加：

```js
import {
  brandNeedsEncryption,
  getClientPemForBrand,
} from './encryption-config.js'
import {
  getAesKeyForBrand,
  encryptAesGcm,
  decryptResponseInPlace,
} from './encrypt-ecdh-aes-gcm.js'
```

### 5.2 在 `LoginNeeded` class 內新增私有 helper

接近 class 內其他 method（建議放在 `loginApi` 之前，line ~181 附近）：

```js
get _needsEncryption() {
  return brandNeedsEncryption(this.brandName)
}

async _ensureAesKey() {
  return getAesKeyForBrand(this.brandName, {
    apiBaseUrl: this.apiBaseUrl,
    clientPem: getClientPemForBrand(this.brandName),
  })
}

// 把 plain object payload 加密後 POST 出去，拿回的 response 解密回 response.data.data
// 統一用 application/x-www-form-urlencoded 送 { iv, message }，與 FedHabit 前端攔截器一致
async _encryptedPost(url, payload, extraHeaders = {}) {
  const aesKey = await this._ensureAesKey()
  const { iv, ciphertext } = await encryptAesGcm(aesKey, payload)
  const body = new URLSearchParams({ iv, message: ciphertext }).toString()
  const headers = {
    'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
    ...extraHeaders,
  }
  const response = await post(url, body, headers)
  return decryptResponseInPlace(aesKey, response)
}

async _encryptedGet(url, options = {}) {
  // GET 沒有 request body 要加密；只解密 response
  const aesKey = await this._ensureAesKey()
  const response = await get(url, options)
  return decryptResponseInPlace(aesKey, response)
}
```

### 5.3 修改五個 API 方法

每個方法的模式都一樣：開頭分流。**現有的呼叫端不用改**——回傳 shape 維持 `{ error, data: { success, data: <decrypted-payload> } }`。

#### `loginApi`（line 181-195）

```js
async loginApi(loginParams = {}) {
  const url = `${this.apiBaseUrl}/api/login`
  const payload = {
    password: Hash(Hash(this.password)),
    deviceFingerprint: this.deviceFingerprint,
    loginName: this.email,
    keepLogin: true,
    ...loginParams,
  }

  if (this._needsEncryption) {
    return this._encryptedPost(url, payload)
  }

  // 原本的 FormData 路徑（其他 brand）
  const formData = new FormData()
  Object.entries(payload).forEach(([k, v]) => formData.append(k, v))
  console.log('登入的 formData:', formData)
  return post(url, formData)
}
```

#### `resendOtp`（line 197-208）

```js
async resendOtp(token) {
  const url = `${this.apiBaseUrl}/api/userDevice/verification`
  const payload = { token, deviceFingerprint: this.deviceFingerprint }

  if (this._needsEncryption) {
    return this._encryptedPost(url, payload)
  }

  const headers = { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }
  return post(url, new URLSearchParams(payload).toString(), headers)
}
```

#### `finalPass`（line 260-275）

```js
async finalPass({ deviceFingerprint, token, otpCode, code2Fa }) {
  const deviceOnlyUrl = `${this.apiBaseUrl}/api/user/check/userDevice`
  const passCodeUrl = `${this.apiBaseUrl}/api/user/check/2FA`
  const url = LoginNeeded.regexpDevice.test(token) ? deviceOnlyUrl : passCodeUrl

  const params = LoginNeeded.regexpDevice.test(token)
    ? { token, deviceFingerprint, passCode: otpCode }
    : { token, deviceFingerprint, otpCode: code2Fa, passCode: otpCode }

  console.log('🔗 finalPass url:', url)
  console.log('finalPass params:', params)

  if (this._needsEncryption) {
    return this._encryptedPost(url, params)
  }

  const headers = { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }
  return post(url, new URLSearchParams(params).toString(), headers)
}
```

#### `getCaptchaImage`（line 230-233）

```js
getCaptchaImage() {
  const url = `${this.apiBaseUrl}/api/user/captcha/image`
  return this._needsEncryption ? this._encryptedGet(url) : get(url)
}
```

#### `checkTokenHealth`（line 277-301）

```js
async checkTokenHealth(token = this.token) {
  if (!token) {
    console.log('⚠️ 缺少 token，無法進行健康檢查')
    return { isHealthy: false, error: null }
  }
  try {
    const url = `${this.apiBaseUrl}/api/user/userStatus`
    const opts = { headers: { Authorization: `Bearer ${token}` } }
    const { error, data } = this._needsEncryption
      ? await this._encryptedGet(url, opts)
      : await get(url, opts)

    return {
      isHealthy: !error && data?.success && data?.data === 'ONLINE',
      statusCode: data?.status,
      error,
    }
  } catch (error) {
    errorConsole('❌ Token 健康檢查失敗:', error)
    return { isHealthy: false, error: error.message }
  }
}
```

---

## 6. `settings.json` schema 更新

範例：

```json
{
  "loginProfiles": [
    {
      "displayName": "fedhabit-test",
      "brandName": "fedhabit",
      "email": "...",
      "password": "...",
      "secretCode2Fa": "...",
      "deviceFingerprint": ""
    }
  ],
  "brand-list": { },
  "redis": { "host": "...", "port": 6379 },

  "encryption": {
    "fedhabit": {
      "clientPem": "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEH..."
    }
  }
}
```

**取得 clientPem 的方法**：複製 frontend repo `/Users/flyc.chung/btse/ww/env/.env.fedhabit` 裡 `VUE_APP_CLIENT_PEM=` 後面那串 base64（不要含 `=` 號前的變數名）。

> ⚠️ 注意：這串雖叫「private key」但因為它跟著前端 bundle 一起出貨，本來就是公開的。但仍應放在 git-ignored 的 `settings.json`，不要 commit 進 repo。

`settings.json.default` 也建議加一個 placeholder 區塊讓人知道有這選項。

---

## 7. 在新 session 要先驗證的事項

開始改之前，請用 `curl` 確認下列幾點，免得寫了一半 schema 對不上：

1. **`/api/init` 的回應 shape**
   ```bash
   curl -s "https://<fedhabit-staging>.btse.co/api/init" | jq
   ```
   預期是 `{ "success": true, "data": "<PEM base64 字串>", ... }`。
   - 若 `data` 不是直接的字串（例如包成 `{ publicKey: "..." }`），改 `encrypt-ecdh-aes-gcm.js` 裡 `generateAesKey` 取 `serverPublicPem` 那一行。

2. **加密 body 是否真的接受 `application/x-www-form-urlencoded`**
   觀察 frontend repo `src/api/instance.ts:62-74` 的攔截器：
   - 原 request `data` 是 FormData 或有 `.params` 欄位 → 加密後仍走 url-encoded
   - 否則 → 加密後送純 JSON `{ iv, message }`

   登入跟 finalPass 在 frontend 那邊都是 url-encoded，所以這份 handoff 預設用 url-encoded。若驗證後發現某個端點實際走 JSON，把該方法改用 `JSON.stringify({ iv, message })` + `content-type: application/json` 即可。

3. **Node 版本**
   ```bash
   node -v   # 需 >= 19，建議 >= 20
   ```
   若太舊，把 `encrypt-ecdh-aes-gcm.js` 開頭加 `import { webcrypto as crypto } from 'node:crypto'` 並把 `crypto.getRandomValues` 那行替換為 `crypto.getRandomValues.bind(crypto)`（或從 `node:crypto` 取 `randomBytes`）。

4. **`brand-list` 裡有沒有 `fedhabit`**
   `LoginNeeded.checkBrandName` 會擋掉不在 `brand-list` 裡的 brand。先在 t99 選單裡跑一次「重新生成 WL 的資訊」確保 `fedhabit` 有對應的 `API_URL`。

---

## 8. 測試清單

跑 `my_alias`（或 `node auto-login/t99.js`）之後選 fedhabit profile：

- [ ] **TC1 - 純帳密登入成功**：profile 裡有正確的 email/password、token cache 為空、不需 OTP/2FA
  - 預期：terminal 看到 `✅ 登入成功`、印出 token
  - 在 `_encryptedPost` 內 `console.log` 加密前的 payload 與 response 解密後的內容，確認雙向都 OK
- [ ] **TC2 - Health check 走加密**：第一次登入成功後立即再跑同一個 profile
  - 預期：先打 `/api/user/userStatus`，response decrypt 後 `data === 'ONLINE'`，跳過重新登入
- [ ] **TC3 - 需要 device OTP**：清掉裝置紀錄、用 fingerprint 沒登過的 profile
  - 預期：`firstToken` match `USER_DEVICE_CHECK_TOKEN_KEY_*`、跑 `otpFlow`、`finalPass` 命中 `/api/user/check/userDevice`、回來解密後可拿到 token
- [ ] **TC4 - 需要 2FA**：profile 有 `secretCode2Fa`、token regex match `USER_2FA_DEVICE_CHECK_TOKEN_KEY_*` 或 `USER_2FA_LOGIN_TOKEN_KEY*`
  - 預期：`finalPass` 命中 `/api/user/check/2FA`、回來成功
- [ ] **TC5 - Captcha 流程**：故意用錯密碼觸發
  - 預期：`getCaptchaImage` 走 GET（response decrypt 沒問題）、redis 取 captchaNumber、第二次登入成功
- [ ] **TC6 - 非加密 brand 不受影響**：跑一個 `btse` profile
  - 預期：完全走原本路徑，沒有意外送 `/api/init`、formData multipart 還在
- [ ] **TC7 - settings.json 沒填 PEM 時**：把 `encryption.fedhabit.clientPem` 拿掉
  - 預期：跑 fedhabit profile 時會在第一次 API 呼叫時 throw 那條清楚的錯誤訊息

---

## 9. 後續延伸（不在本次範圍）

- `chrome-extension/semi-auto-login/`（Chrome popup 那條流程）若也要支援 fedhabit，邏輯基本相同，但執行環境是瀏覽器 service worker / content script，可以**直接用 frontend repo 的 `encryptEcdhAesGcm.ts`**（連 `crypto.subtle` 都同名）。整合點是 `auto-login/server.js` 那條 express 路由 → 那邊已經是 Node side，跟本文件一樣處理即可。
- 若未來 fedhabit 之外還有其他 brand 啟用同套加密，加進 `BRANDS_NEED_ENCRYPTION` 並在 `settings.json.encryption` 裡多一個 entry 即可。

---

## 10. 給接手 session 的 Claude 的提示

- 先 `cat package.json` 跟 `node -v` 確認 Node 版本。
- 動工前先跑 §7 的 curl 驗證 `/api/init` 的 response shape，**不要假設**——這是這份 handoff 唯一沒有 100% 確定的地方。
- 改 `login-stuff.js` 時注意：原本 `loginApi` 與 `getCaptchaImage` 不是 async function，要改成 async（因為新分支會 await）。其他三個（`resendOtp`/`finalPass`/`checkTokenHealth`）原本就是 async 或可以無痛改。
- 不要動 `request-stuff.js` 的 signature——那是底層 fetch wrapper，加密邏輯應該住在 `LoginNeeded` 上而不是污染 fetch 層。
- 完成後跑 `pnpm install`（若加了新依賴）然後手動跑 §8 的測試。專案沒有自動測試。
