# OTP Proxy Server

本地小型 proxy：一次 API 呼叫同時拿到「QA 內部 email OTP 服務」的 payment/spot OTP，以及用本機存的 `secretCode2Fa` 算出的 2FA (TOTP) code。另外還有一個查詢已存 profile 的端點，方便手動核對帳密 / 2FA。

⚠️ **這個 server 完全沒有身分驗證，而且 `/profiles` 會把 `password`、`secretCode2Fa` 用明文回傳。只給本機用，不要把這個 port 對外開放。**

---

## 啟動

透過 t99 主選單：

```
my_alias  →  選「OTP Proxy Server 啟動 2FA / OTP 取碼 proxy」
```

會問你要用哪個 port（預設 `4021`），即時檢查是否被占用，被占用會要你換一個。啟動後會印出下面兩個端點的用法跟範例 curl。

---

## `POST /get-otp`

一次拿三種東西：QA 的 payment OTP、QA 的 spot OTP、本機算的 2FA code。

**Request body**（都必填）：

| 欄位 | 說明 |
| --- | --- |
| `user` | 要查的帳號識別碼。**只影響本機 2FA 查詢**，QA 那兩個一律當 email 用（見下方「`user` 到底要傳 email 還是 username」） |
| `brand` | brand 名稱，跟 `settings.json` 裡 `loginProfiles[].brandName` 一致 |

```bash
curl -X POST http://localhost:4021/get-otp \
  -H 'Content-Type: application/json' \
  -d '{"user":"fc4btsestaging","brand":"btse"}'
```

**Response**：

```jsonc
{
  "user": "fc4btsestaging",
  "brand": "btse",
  "paymentOtp": "123456",   // 查不到時是 null
  "spotOtp": "654321",      // 查不到時是 null
  "2fa": "789012",          // 本機沒有對應 profile 的 secretCode2Fa 時是 null
  "errors": {                // 三者全部成功時這個 key 不會出現
    "payment": "...",
    "spot": "...",
    "twoFa": "..."
  }
}
```

### `paymentOtp` / `spotOtp` 是怎麼來的

打 QA 提供的內部服務（`qaClient.js`；endpoint / body 格式是 QA 定的，我們自己包一層統一格式），送出的 body 是 `{ email: user, whitelabel: brand, scope }`（`scope` 分別是 `payment` / `spot`）。

**這裡的 `user` 是直接原樣轉發給 QA 當 `email` 用的** —— QA 這個服務目前看起來是照 email 去查有沒有寄出過 OTP，所以如果 `user` 傳的是 username（不是真的 email），payment/spot 這兩個大概率查不到（`errors.payment` / `errors.spot` 會出現），但不影響下面的本機 2FA 那一段。

還沒拿到一次真實成功回應確認過 QA 回應的欄位名稱，目前是用 `otp` / `code` / `data.otp` / `data.code` 這幾個常見 key 去猜（`qaClient.js` 的 `OTP_VALUE_KEYS`）。之後如果撈不到值，先確認一下 QA 實際回應長怎樣、把正確的 key 加進那個清單即可，不用改其他地方。

### `2fa` 是怎麼來的

在 `settings.json` 的 `loginProfiles` 裡找 `brandName === brand` 且（`username === user` 或 `email === user`）的那一筆，拿它的 `secretCode2Fa` 算 TOTP（`secrets-storage.js` 的 `getSecret()`）。

`username` 是後來才補上的欄位（見 t99 主選單的「Profile 補齊 username」），舊 profile 可能還沒有，這時候會 fallback 用 `email` 比對。

### `user` 到底要傳 email 還是 username?

- **本機的 2FA 查詢**：`username` 或 `email` 都吃，看你的 profile 有沒有 `username` 欄位。
- **QA 的 payment/spot OTP**：只吃真的 email（因為那是直接轉發給 QA 服務當 `email` 用）。

想三個都拿到就傳真的 email 最保險；只想拿本機 2FA 的話傳 username 也行，只是 payment/spot 那兩欄會是 `null` 加對應的 error。

---

## `GET /profiles`

查已存在 `settings.json` 的 login profile（account/password/2FA），方便手動核對用。

**Query 參數**（都選填，沒帶就是全部）：

| 參數 | 說明 |
| --- | --- |
| `brand` | 精確比對 `brandName` |
| `username` | 子字串比對，先比對 `username` 欄位，比對不到再 fallback 比對 `email` |

```bash
curl 'http://localhost:4021/profiles?brand=btse&username=fc4'
```

回的是**原始 profile 物件**，包含 `password`、`secretCode2Fa`（明文）——這也是為什麼這個 server 完全不能對外開放的原因。

---

## 檔案結構

```
otp-proxy/
  index.js              t99 選單進來的入口: 問 port → 啟動 → 印使用說明
  server.js             express app: /get-otp、/profiles 兩條路由
  qaClient.js           打 QA 內部 OTP 服務 (payment/spot)
  secrets-storage.js    讀 settings.json 的 loginProfiles、依 username/email + brand 找 secretCode2Fa
```
