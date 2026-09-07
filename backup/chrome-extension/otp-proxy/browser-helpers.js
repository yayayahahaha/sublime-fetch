/*
  瀏覽器端的登入輔助工具 —— 由 otp-proxy 用 GET /browser-helpers.js 吐給頁面：

    const { getProfileList, loginByUsername, inputOtp } =
      await import('http://localhost:4021/browser-helpers.js')

  ⚠️ 這支檔案是**在瀏覽器裡**執行的（不是 node），所以不要 import 任何 node 模組。
  改完存檔即生效, 不用重啟 server（server 那邊每次 request 重讀）。

  ─── 設計原則 ────────────────────────────────────────────
  **密碼與 OTP 一律不離開這支檔案。** 三個 function 自己去 otp-proxy 拿憑證、
  自己填進畫面, 回傳值只有「做了什麼」而沒有任何秘密。這樣呼叫端（人或 agent）
  不需要、也拿不到憑證。

  所以 getProfileList() 刻意過濾掉 password / secretCode2Fa —— 它的用途是
  「選帳號」, 不是「讀秘密」。
*/

// 這支檔案是從 otp-proxy 載入的, 所以 server 的位置直接從自己的 URL 推導
const API_ORIGIN = new URL(import.meta.url).origin

// ─── 畫面元素（跟著前端的 id 走, 前端改了這裡也要改）────────────
const SELECTOR = {
  loginUsername: '#login_username',
  loginPassword: '#login_password',
  loginSubmit: '#login_submit',
  otpCode: '#input_optcode',
  // auth-device 的 Verify 按鈕沒有 id, 只能靠文字找
  otpVerifyText: 'Verify'
}

/*
  Vue 的 v-model 監聽 input 事件, 而且會把值記在 el._value 上做比對 ——
  直接 el.value = x 只改 DOM、不會通知 Vue。必須用 native setter 再 dispatch。
*/
const nativeInputSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  'value'
).set

function setInputValue(el, value) {
  nativeInputSetter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

async function waitFor(getter, { timeout = 15000, label = '目標' } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const found = getter()
    if (found) return found
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error(`[browser-helpers] 等不到${label}（${timeout}ms）`)
}

function requireEl(selector, label) {
  const el = document.querySelector(selector)
  if (!el) throw new Error(`[browser-helpers] 找不到${label}（${selector}）`)
  return el
}

async function api(path, init) {
  const res = await fetch(`${API_ORIGIN}${path}`, init)
  if (!res.ok) {
    throw new Error(`[browser-helpers] ${path} 回 ${res.status}`)
  }
  return res.json()
}

/**
 * 列出可用的測試帳號。**不含密碼與 2FA secret。**
 *
 * @param {{ brand?: string }} options
 * @returns {Promise<Array<{ displayName, brandName, email, username, has2Fa }>>}
 *   has2Fa = profile 裡有 secretCode2Fa（可以拿 TOTP）。
 *   ⚠️ 這跟「帳號在後端有沒有綁 2FA」不是同一件事, 只代表這台能不能算出 TOTP。
 */
export async function getProfileList({ brand } = {}) {
  const query = brand ? `?brand=${encodeURIComponent(brand)}` : ''
  const profiles = await api(`/profiles${query}`)

  return profiles.map(p => ({
    displayName: p.displayName,
    brandName: p.brandName,
    email: p.email,
    username: p.username ?? null,
    has2Fa: Boolean(p.secretCode2Fa)
  }))
}

/**
 * 用帳號登入：自己去拿密碼、填表、送出。
 *
 * @param {string} identifier email / username / displayName 都可以（不分大小寫、可部分比對）
 * @param {{ brand?: string }} options
 * @returns {Promise<{ identifier: string, filledWith: string, submitted: true }>}
 *   filledWith 是實際填進欄位的帳號字串（不含密碼）
 */
async function findProfile(identifier, brand) {
  const query = brand ? `?brand=${encodeURIComponent(brand)}` : ''
  const profiles = await api(`/profiles${query}`)

  const needle = identifier.toLowerCase()
  const profile = profiles.find(p =>
    [p.username, p.email, p.displayName]
      .filter(Boolean)
      .some(v => v.toLowerCase().includes(needle))
  )

  if (!profile) {
    const available = profiles.map(p => p.displayName).join(' / ')
    throw new Error(
      `[browser-helpers] 找不到帳號 '${identifier}'。可用的：${available}`
    )
  }

  return profile
}

/*
  QA 的 OTP API 認的是「交易所 username 去掉 @brand 後綴」的形式:
    profile.username = 'fc1nvxstg@nvx'  →  OTP API 要 'fc1nvxstg'

  ⚠️ 這是登入表單與 OTP API 用不同識別字串造成的 —— 登入吃 email,
  OTP 吃 username。目前只能在這裡轉換。
*/
function toOtpUser(profile) {
  if (!profile.username) return null

  return profile.username.split('@')[0]
}

export async function loginByUsername(identifier, { brand } = {}) {
  if (!identifier) throw new Error('[browser-helpers] loginByUsername 需要 identifier')

  const profile = await findProfile(identifier, brand)

  if (!profile.password) {
    throw new Error(`[browser-helpers] '${profile.displayName}' 沒有存密碼`)
  }

  // 登入欄位吃 "Email or Username", email 比較保險
  const account = profile.email ?? profile.username

  const usernameEl = await waitFor(
    () => document.querySelector(SELECTOR.loginUsername),
    { label: '登入頁的帳號欄位' }
  )
  const passwordEl = requireEl(SELECTOR.loginPassword, '密碼欄位')
  const submitEl = requireEl(SELECTOR.loginSubmit, '登入按鈕')

  setInputValue(usernameEl, account)
  setInputValue(passwordEl, profile.password)

  // 等 Vue 跑完驗證, 按鈕才真的可以按（class 上的 disabled 是純樣式）
  await waitFor(
    () =>
      !submitEl.disabled && !submitEl.className.includes('disabled')
        ? submitEl
        : null,
    { label: '登入按鈕變成可按', timeout: 5000 }
  )

  submitEl.click()

  return { identifier, filledWith: account, submitted: true }
}

/**
 * 填 OTP 並送出（新裝置驗證 / 其他要驗證碼的頁面）。
 *
 * @param {string} identifier 跟 loginByUsername 一樣 —— email / username /
 *   displayName 都可以。OTP API 要的 user 會自己從 profile.username 推導
 *   （去掉 @brand 後綴）。
 * @param {{ brand?: string, field?: 'spotOtp' | 'paymentOtp' | '2fa', otpUser?: string }} options
 *   field 預設 spotOtp —— 登入 / 新裝置的 email 驗證碼走這個欄位。
 *   otpUser 可以直接指定, 繞過 profile 推導（profile 沒有 username 時用）。
 * @returns {Promise<{ otpUser: string, field: string, submitted: true }>} 不含驗證碼本身
 */
export async function inputOtp(
  identifier,
  { brand = 'nvx', field = 'spotOtp', otpUser: otpUserOverride } = {}
) {
  if (!identifier && !otpUserOverride) {
    throw new Error('[browser-helpers] inputOtp 需要 identifier 或 otpUser')
  }

  let otpUser = otpUserOverride
  if (!otpUser) {
    const profile = await findProfile(identifier, brand)
    otpUser = toOtpUser(profile)

    if (!otpUser) {
      throw new Error(
        `[browser-helpers] '${profile.displayName}' 的 profile 沒有 username, ` +
          `無法推導 OTP API 的 user —— 請補上 username 或改傳 { otpUser }`
      )
    }
  }

  const result = await api('/get-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: otpUser, brand })
  })

  const code = result[field]
  if (!code) {
    throw new Error(
      `[browser-helpers] 拿不到 ${field}（user=${otpUser}）。` +
        `errors=${JSON.stringify(result.errors ?? {})}`
    )
  }

  const codeEl = await waitFor(
    () => document.querySelector(SELECTOR.otpCode),
    { label: '驗證碼欄位' }
  )
  setInputValue(codeEl, code)

  const verifyEl = await waitFor(
    () => {
      const btn = [...document.querySelectorAll('button')].find(
        b => b.textContent.trim() === SELECTOR.otpVerifyText
      )
      return btn && !btn.disabled ? btn : null
    },
    { label: 'Verify 按鈕變成可按', timeout: 5000 }
  )

  verifyEl.click()

  return { otpUser, field, submitted: true }
}
