# My Awesome Magic Box

> Less is more.

這個專案是一套透過 terminal 操作的多功能腳本:

- 自動登入 staging 各 brand
  - 支持多個登入 profile 設定 (一個 WL 多帳號 OK)
  - 自動處理 2FA / OTP / device check
  - Token cache + health check, 第二次起跳過完整登入
- Admin 系列工具 (共用 admin token cache, 第二次起免 2FA)
  - 登入 Staging Admin (取 token 並開瀏覽器)
  - 清除 Email staging 環境的 cache
  - 幫指定 user deposit USDT (含切 role / 找 user (支援 fuzzy) / approve / 2FA replay 防護)
  - 幫當前 admin 加上指定 brand 的 role (需有 Administrator)
- Redis 操作 (對 dev / staging 的 key 做 list / 查 / 刪)
- 小工具: 2FA 助手、Jira branch 名生成器、Chrome 視窗助手、Mock Server、批量註冊

---

## 透過 terminal 操作的自動登入腳本

### 如何使用

> 繁瑣的手把手

#### 事前準備 1: 填好用於登入的 login profile 資料

1. 複製 `settings.json.default` 成 `settings.json`, 並修改其內容

```bash
# 當前這個專案
cp settings.json.default settings.json
```

`settings.json` 的內容範例

```json
{
  "loginProfiles": [
    {
      "displayName": "btse",
      "brandName": "btse",
      "email": "flyc.chung@btse.com",
      "password": "請輸入你的密碼",
      "secretCode2Fa": "請輸入你的 2fa secret code, 請注意是測試環境的，不要放成 prod 的了",
      "deviceFingerprint": "finter print 不輸入也沒關係, falsy 的話會變成一個預設的"
    },
    {
      "displayName": "btse-fc1",
      "brandName": "btse",
      "email": "fc1@mailto.plus",
      "password": "請輸入你的密碼",
      "secretCode2Fa": "",
      "deviceFingerprint": "btse-staging-fingerprint"
    }
  ],

  "adminAccounts": [
    {
      "account": "你的 admin 登入帳號 (跟 admin UI 登入用的那個一致)",
      "password": "你的 admin 密碼",
      "secretCode2Fa": "admin 的 2FA secret code (Authenticator app 那個 entry)"
    }
  ],

  "brand-list": {}, // 這裡的資訊會由 `❯ 重新生成 WL 的資訊` 這個功能生成

  "frontend-repo-path": "這裡要放 frontend repo 的絕對路徑，用於生成 brand-list 的部分",

  "redis": {
    "host": "10.41.242.181",
    "port": 6379
  }
}
```

> 當前 staging 環境的 redis host 為 `10.41.242.181` (#註5: 這個 IP 偶爾會被換, 跑 redis 相關功能撞牆時, 用 `Redis 對 Redis 操作` 那個 entry 去 dev / staging 看實際的 IP 再回填)

以下為 `settings.json` 裡的 `loginProfiles` 的物件格式

| 屬性              | 是否必填 | 描述                                                                        |
| ----------------- | -------- | --------------------------------------------------------------------------- |
| displayName       | **Yes**  | 用於區分每個 login profile 的 primary-key, 同時也是 terminal 選項的顯示名稱 |
| brandName         | **Yes**  | 要登入的 brand 名稱 #註1                                                    |
| email             | **Yes**  | 就是 email                                                                  |
| password          | **Yes**  | 就是 password                                                               |
| secretCode2Fa     | No       | 如果有綁定 2FA(Google auth) 的話，請輸入當時生成用的 secret code (註2)      |
| deviceFingerprint | No       | 用於模擬裝置的 fingerprint, 輸入的是 falsy 的話會生成一個預設的             |

`adminAccounts` 是 Admin 系列功能 (Admin Login / Email Cache / Deposit / Role add) 用的; 沒打算用 admin 相關功能的話可以略過

| 屬性          | 是否必填 | 描述                                                            |
| ------------- | -------- | --------------------------------------------------------------- |
| account       | **Yes**  | admin 登入帳號 (跟 admin UI 上登入的那個 username 一致)         |
| password      | **Yes**  | admin 密碼                                                      |
| secretCode2Fa | **Yes**  | admin 的 2FA secret (Authenticator app 那個 entry 的 secret #註2) |

> 註1: 這邊對應的是 frontend repo 的 config/envConfig.js 裡面的 key, 如果要登入 BTSE 的話會是用 "btse"  
> 註2: 如果是用 [這個](https://chromewebstore.google.com/detail/authenticator/bhghoamapcdpbohphigoooaddinpkbai) 瀏覽器套件的話，可以透過他的 export 功能取得 secret code

#### 事前準備 2: 設定 terminal 的 alias 以利透過 terminal 指令執行腳本

> 這邊以 [`zsh`](https://www.zsh.org/) 作為範例 (註3)

請確認自己裝置的 家目錄 下有沒有 `.zprofile` 這個檔案，有的話可以直接操作，沒有的話可以創建一個空的

```bash
# 如果家目錄下沒有 .zprofile
touch ~/.zprofile
```

接著，在生成的 `~/.zprofile` 裡的最下面添加 `alias`, 讓此 `alias` _直接執行_ 當前這個專案的 nodejs 腳本

```bash
# ~/.zprofile

# ...

alias my_alias="node $當前這個專案的完整路徑/auto-login/t99.js" # 註4
```

設定完成後，需要重新執行一次 rc 和 profile

```bash
# 任何路徑
source ~/.zshrc;
source ~/.zprofile;
```

最後，測試 alias 有被正確設定即可, 會顯示方才設定的結果

```bash
# 任何路徑
type my_alias
```

> 註3: 如果是一般的 [`bash`](https://www.gnu.org/software/bash/), 對應的檔案為 `~/.profile` 和 `~/.bashrc`  
> 註4: 什麼是 `t99`?
>
> > 我也不知道，一瞬間閃過腦海的名字 by fc

#### 開始使用

先安裝需要的 `node_modules`, 這邊使用的是 [`pnpm`](https://pnpm.io/)

```bash
# 當前這個專案
pnpm install
```

接著，運行方才設定好的 terminal `alias`, 即可看到方才設定的 login profile 的資料被讀取成 selector, 依照選擇進行後續操作即可

```bash
my_alias
```

運行截圖:

![auto-login-script-result](./readme-image/auto-login-script-result.png)

> 截圖裡設定的快捷鍵是 `lll`

#### 命令列參數 (cmdArgs)

執行時可以帶 args 直接帶入選項, 跳過互動式選單:

```bash
my_alias --profile=btse --port=3000
```

| 參數      | 對應 menu 項                                              |
| --------- | --------------------------------------------------------- |
| `profile` | 直接套用該 `displayName` 的 login profile, 跳過 selector |
| `port`    | 跳過 port 輸入, 開啟對應 `localhost:<port>` 而非 staging  |

### Terminal 主功能簡介

```
my_alias
```
跑起來會看到 selector, 選哪個就執行對應功能:

| Menu 選項                                  | 做什麼                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| 重新生成 WL 的資訊                         | 從 frontend repo 撈各 brand 的 API URL / WS / Chart-feed 等資訊, 寫回 `brand-list`    |
| Redis 對 Redis 操作                        | 對 dev / staging 的 redis 做 list / 查 / 刪等 (自動偵測 cluster / standalone)         |
| Mock Server 啟動有 mock api 的 server      | 啟動本地 mock server (mock 指定 api / websocket, 其餘 proxy 到真實後端)               |
| 2FA 助手                                   | 讀取 / 生成 / 編輯 / 刪除 2FA Code (來源是 settings 裡的 secret)                      |
| Jira Branch 生成器                         | 透過 Jira 標題生成 git branch name                                                    |
| Chrome 視窗助手                            | 列出 Chrome 視窗、刷新、複製 URL、執行 JS                                             |
| Register 批量註冊帳號                      | 批量註冊 staging 帳號 (對應 `settings.registrationList`)                              |
| Admin Login 登入 Staging Admin             | 取得 admin token + 開瀏覽器 (帶 cache, 第二次起跳過 2FA)                              |
| Email Cache 清除 Email Staging 環境的 Cache | 上完 staging email 樣板後手動清 cache (帶 cache, 免 2FA)                              |
| Deposit 儲值 USDT 給 user                  | 自動 deposit USDT, 含: 切 role / fuzzy 找 user / 送申請 / approve (帶 2FA replay 防護) |
| Role add 幫自己加 Admin Role               | 幫當前 admin 加上指定 brand 的 role (需有 Administrator)                              |
| `<profile displayName>`                    | 對該 profile 跑自動登入                                                               |

#### Admin Token Cache + Health Check

Admin 系列功能 (Login / Email Cache / Deposit / Role add) 共用一份 cache 在 `cache/admin-token-cache.json`:

- 第一次跑會完整登入 (3 個 admin API + 2FA), 成功後寫入 cache
- 之後再跑會先做 health check (打 `/api/admin/adminInfo`), 還活著就直接用 token, **完全跳過 2FA**
- Token 失效就自動移除 + 重新登入
- 另外會記錄上次 approve 用過的 2FA OTP — 連續 deposit 撞同一個 30s window 時會自動等下一個 window, 避免 backend replay 防護拒收

### 注意事項

- 💥 第一次運行時，設定檔裡的 `brand-list` 會是空的，記得執行一次 `❯ 重新生成 WL 的資訊` 這個指令
- 💥 是有可能登入失敗的，這個時候可以參考 terminal 裡的錯誤訊息，通常是 opt 的問題，可以去 admin 那邊解除
  > ![login-failed](./readme-image/login-failed.png)
- 💥 `Register 批量註冊帳號` 對**啟用 Geetest 的 brand (例如 btse)** 目前無法用 — 後端要 `passToken` (瀏覽器解 challenge 才拿得到), 純 API 沒辦法繞。會在 captcha retry 3 次後失敗。這類 brand 暫時只能手動到 staging 頁面註冊。
