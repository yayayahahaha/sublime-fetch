import select from '@inquirer/select'
import { input, confirm } from '@inquirer/prompts'
import { loadLoginProfiles } from './profile-loader.js'
import { loadSettings, saveSettings } from './settings-loader.js'
import { get, post } from './request-stuff.js'
import { gen2FaCode, get2FaTimeRemaining } from './2fa.js'
import { connectRedis } from './redis.js'
import { errorConsole, loginWithCache } from './t99-utils.js'
import { blue, lightBlue, lightCyan, lightGreen, yellow } from '../color.js'
import { runResetUserOtpLimitCli } from '../admin-related/reset-user-otp-limit.js'

// 從實際跑到的錯誤反推出來的: user 端 OTP email 已達寄送上限 (跟 admin 端 unlockOTPLimit 解除的是同一個限制)
const OTP_EMAIL_LIMIT_CODE = 10206

const READ = 'READ'
const REMOVE_2FA = 'REMOVE_2FA'
const FORCE_REBIND = 'FORCE_REBIND'

// reqType: 1 = 綁定用的 email 驗證碼, 2 = 解除綁定用的 email 驗證碼 (依 otpEmail API 觀察到的行為)
const OTP_EMAIL_REQ_TYPE_BIND = 1
const OTP_EMAIL_REQ_TYPE_UNBIND = 2

const EMAIL_OTP_POLL_ATTEMPTS = 3
const EMAIL_OTP_POLL_DELAY_MS = 1500

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 跟 admin-related/deposit.js 的 approve 那段同一套邏輯: 只是「在最後一刻算」還不夠保險,
// 如果剛好算的時候 TOTP window 快過期了 (可能生完送到後端就跨 window 被拒), 就先等到下一個 window 開始再生成,
// 確保有接近完整的 30 秒可用, 抵銷網路延遲等不確定的耗時
const MIN_TOTP_WINDOW_REMAINING = 3

async function genFreshTotpCode(secret) {
  const remainingNow = get2FaTimeRemaining()
  if (remainingNow >= MIN_TOTP_WINDOW_REMAINING) {
    return gen2FaCode(secret, { verbose: false })
  }

  const waitSec = remainingNow + 1
  console.log(yellow(`⏳ 目前 TOTP window 只剩 ${remainingNow}s, 等 ${waitSec}s 到下一個 window 再產生 code...`))
  await delay(waitSec * 1000)
  return gen2FaCode(secret, { verbose: false })
}

// 觸發 otpEmail 寄信後, 依序嘗試: 已知/猜測的 key -> 用 username/email 掃描 Redis, 找不到就重試幾次
// 全部都找不到的話回傳 null, 由呼叫端 fallback 成請使用者手動輸入
// purpose: 'BIND' 或 'UNBIND', 因為 bind 跟 unbind 用的 email OTP 是不同的 redis key
async function autoFetchEmailOtp({ username, email, brandName, purpose }) {
  const redis = connectRedis()
  try {
    const type = purpose === 'BIND' ? 'TWO_FA_BIND' : 'TWO_FA_UNBIND'

    for (let attempt = 1; attempt <= EMAIL_OTP_POLL_ATTEMPTS; attempt += 1) {
      if (username != null) {
        const { ok, value } = await redis
          .getOtp(username, { brandName, type })
          .catch((error) => ({ ok: false, value: null, error }))
        if (ok && value != null) return value
      }

      const scanResult = await redis.findOtpByScan([username, email])
      if (scanResult.ok && scanResult.value != null) return scanResult.value

      if (attempt < EMAIL_OTP_POLL_ATTEMPTS) {
        console.log(
          yellow(
            `還沒在 Redis 找到 email 驗證碼, ${EMAIL_OTP_POLL_DELAY_MS / 1000} 秒後重試 (${attempt}/${EMAIL_OTP_POLL_ATTEMPTS})...`,
          ),
        )
        await delay(EMAIL_OTP_POLL_DELAY_MS)
      }
    }
    return null
  } finally {
    redis.disconnect()
  }
}

// 自動嘗試從 Redis 取得 email 驗證碼, 失敗才 fallback 成手動輸入
async function resolveEmailOtp({ username, email, brandName, purpose }) {
  console.log(lightBlue('嘗試自動從 Redis 取得 email 驗證碼...'))
  const otpCodeEmail = await autoFetchEmailOtp({ username, email, brandName, purpose })
  if (otpCodeEmail != null) {
    console.log(lightGreen('✅ 自動取得 email 驗證碼: '), otpCodeEmail)
    return otpCodeEmail
  }

  console.log(yellow('⚠️ 自動取得失敗 (可能是還沒寄達或 key 格式跟猜測的不一樣), 請手動輸入'))
  return input({ message: '請輸入收到的 email 驗證碼:' }).catch(() => null)
}

class TwoFaProfileApi {
  constructor(loginNeeded, token) {
    this.loginNeeded = loginNeeded
    this.token = token
  }

  get authHeaders() {
    return { Authorization: `Bearer ${this.token}` }
  }

  get formHeaders() {
    return { ...this.authHeaders, 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }
  }

  getAccount() {
    const url = `${this.loginNeeded.apiBaseUrl}/api/user/account`
    return post(url, '', this.authHeaders)
  }

  // 觸發 otpEmail 寄信; 如果剛好卡在 OTP email 寄送上限, 問要不要用 admin 權限解除後重新發送一次
  async requestEmailOtp(reqType) {
    const url = `${this.loginNeeded.apiBaseUrl}/api/user/otpEmail`
    const params = new URLSearchParams({ reqType, email: '' }).toString()

    const result = await post(url, params, this.formHeaders)
    if (result.error?.code !== OTP_EMAIL_LIMIT_CODE) return result

    console.log()
    console.log(yellow(`⚠️ 發送 email 驗證碼卡在 OTP email 寄送上限: ${result.error?.msg}`))
    const shouldReset = await confirm({
      message: '要現在用 admin 權限解除這個 user 的 OTP 限制, 然後重新發送一次嗎?',
      default: true,
    }).catch(() => false)
    if (!shouldReset) return result

    await runResetUserOtpLimitCli({ brandName: this.loginNeeded.brandName, email: this.loginNeeded.email })

    console.log()
    console.log(lightBlue('重新發送 email 驗證碼...'))
    return post(url, params, this.formHeaders)
  }

  bindNewGoogleDevice() {
    const url = `${this.loginNeeded.apiBaseUrl}/api/v2/user/bindNewGoogleDevice`
    return get(url, { headers: this.authHeaders })
  }

  newGoogleAuth({ code, totpKey, otpCodeEmail }) {
    const url = `${this.loginNeeded.apiBaseUrl}/api/v2/user/newGoogleAuth`
    const params = new URLSearchParams({ code, totpKey, otpCodeEmail }).toString()
    return post(url, params, this.formHeaders)
  }

  untieNewGoogleDevice({ totpCode, otpCodeEmail }) {
    const url = `${this.loginNeeded.apiBaseUrl}/api/v2/user/untieNewGoogleDevice`
    const params = new URLSearchParams({ totpCode, otpCodeEmail }).toString()
    return post(url, params, this.formHeaders)
  }
}

// 登入; 用 loginWithCache (跟 t99.js 的一般登入共用同一份 cache/cache.json) 而不是直接 payload.login(),
// 這樣快速重跑這個功能時才能吃到 healthCheck 命中既有 token, 不會每次都重新觸發 device OTP / 2FA
// (直接 payload.login() 的話, payload.token 永遠是 null, healthCheck 一定跳過, 每次都會是全新登入)
//
// 如果剛好卡在 OTP email 寄送上限, 問要不要現在用 admin 權限解除這個 user 的限制, 解除完再登入一次
async function loginWithOtpLimitRetry(payload, displayName) {
  const loginResult = await loginWithCache(payload)
  if (loginResult.error?.code !== OTP_EMAIL_LIMIT_CODE) return loginResult

  console.log()
  console.log(yellow(`⚠️ 登入卡在 OTP email 寄送上限: ${loginResult.error?.msg}`))
  const shouldReset = await confirm({
    message: '要現在用 admin 權限解除這個 user 的 OTP 限制, 然後重新登入一次嗎?',
    default: true,
  }).catch(() => false)
  if (!shouldReset) return loginResult

  await runResetUserOtpLimitCli({ brandName: payload.brandName, email: payload.email })

  console.log()
  console.log(lightBlue(`重新登入 ${displayName}...`))
  return loginWithCache(payload)
}

export async function twoFaProfileHelper() {
  let loginProfiles
  try {
    ;({ loginProfiles } = loadLoginProfiles())
  } catch (error) {
    errorConsole(error.message)
    return
  }

  if (loginProfiles.length === 0) {
    errorConsole('settings.json 裡沒有找到任何 loginProfiles')
    return
  }

  const displayName = await select({
    message: '請選擇要操作 2FA 的 profile:',
    choices: loginProfiles.map((item) => ({ name: item.displayName, value: item.displayName })),
    loop: false,
  }).catch(() => null)
  if (displayName == null) return void errorConsole('使用者取消')

  const payload = loginProfiles.find((item) => item.displayName === displayName)?.value
  if (payload == null) return void errorConsole('找不到對應的 profile')

  console.log()
  console.log(lightBlue(`登入 ${displayName} 中, 取得可用的 token...`))
  const loginResult = await loginWithOtpLimitRetry(payload, displayName)
  if (loginResult.error != null) {
    errorConsole('登入失敗, 無法繼續操作 2FA: ', loginResult.error?.message ?? loginResult.error)
    return
  }
  console.log(lightGreen('✅ 登入成功'))

  const action = await select({
    message: `對 ${blue(displayName)} 的 2FA 要做什麼?`,
    choices: [
      { name: '讀取 (查看目前 2FA 綁定狀態)', value: READ },
      { name: '移除 2FA (解除綁定)', value: REMOVE_2FA },
      { name: '強制重新綁定 (若已綁定會先解除, 再綁新的)', value: FORCE_REBIND },
    ],
  }).catch(() => null)
  if (action == null) return void errorConsole('使用者取消')

  const api = new TwoFaProfileApi(payload, loginResult.token)

  if (action === READ) return void (await runRead(api))
  if (action === REMOVE_2FA) return void (await runRemove(api, payload))
  if (action === FORCE_REBIND) return void (await runForceRebind(api, payload))
}

async function fetchAccount(api) {
  const { error, data } = await api.getAccount()
  if (error != null || data?.success !== true) {
    errorConsole('查詢帳號狀態失敗: ', error ?? data?.msg)
    return { error: error ?? data?.msg }
  }
  return { account: data.data }
}

async function runRead(api) {
  console.log()
  console.log(lightBlue('查詢目前 2FA 綁定狀態...'))
  const { error, account } = await fetchAccount(api)
  if (error != null) return

  console.log()
  console.log(lightCyan('----------------------------------'))
  console.log('帳號: ', blue(account?.email ?? account?.username ?? ''))
  console.log(
    '目前 2FA (Google Auth) 綁定狀態: ',
    account?.isGoogleBind ? lightGreen('已綁定 ✅') : yellow('未綁定 ❌'),
  )
  console.log(lightCyan('----------------------------------'))
}

// 執行「解除既有 2FA 綁定」的實際流程, 回傳是否成功, 不碰 settings.json
async function performUntie(api, payload) {
  const { error: accountError, account } = await fetchAccount(api)
  if (accountError != null) return false

  if (!account?.isGoogleBind) {
    console.log(yellow('目前這個帳號並未綁定 2FA (Google Auth), 不需要解除'))
    return true
  }

  console.log(lightBlue('發送 email 驗證碼 (解除綁定用)...'))
  const { error: sendError, data: sendData } = await api.requestEmailOtp(OTP_EMAIL_REQ_TYPE_UNBIND)
  if (sendError != null || sendData?.success !== true) {
    errorConsole('發送 email 驗證碼失敗: ', sendError ?? sendData?.msg)
    return false
  }
  console.log(lightGreen('✅ email 驗證碼已發送, 請去收信'))

  const otpCodeEmail = await resolveEmailOtp({
    username: account?.username,
    email: payload.email,
    brandName: payload.brandName,
    purpose: 'UNBIND',
  })
  if (!otpCodeEmail) {
    errorConsole('沒有可用的 email 驗證碼, 中止')
    return false
  }

  const isConfirm = await confirm({
    message: `確定要解除 ${blue(payload.email)} 的 2FA 綁定嗎?`,
    default: false,
  }).catch(() => false)
  if (!isConfirm) {
    console.log(yellow('已取消'))
    return false
  }

  // 在最後一刻才算 TOTP code: 前面 email OTP 查詢/使用者確認都可能耗掉超過 30 秒, 太早算會過期
  const totpCode = payload.secretCode2Fa
    ? await genFreshTotpCode(payload.secretCode2Fa)
    : await input({ message: '這個 profile 沒有存 secretCode2Fa, 請手動輸入目前的 2FA (Google Auth) code:' }).catch(
      () => null,
    )
  if (!totpCode) {
    errorConsole('沒有可用的 2FA code, 中止')
    return false
  }

  const { error, data } = await api.untieNewGoogleDevice({ totpCode, otpCodeEmail })
  if (error != null || data?.success !== true) {
    errorConsole('解除 2FA 綁定失敗: ', error ?? data?.msg)
    return false
  }
  console.log(lightGreen(`✅ ${data?.msg ?? '2FA 已解除綁定'}`))
  return true
}

async function runRemove(api, payload) {
  const untied = await performUntie(api, payload)
  if (!untied) return

  const shouldClear = await confirm({
    message: `是否要清除 settings.json 裡 ${blue(payload.email)} 這個 profile 的 secretCode2Fa?`,
    default: true,
  }).catch(() => false)
  if (!shouldClear) return

  updateStoredSecret(payload, '')
  console.log(lightGreen('✅ 已清除 settings.json 裡的 secretCode2Fa'))
}

async function runForceRebind(api, payload) {
  const { error: accountError, account } = await fetchAccount(api)
  if (accountError != null) return

  if (account?.isGoogleBind) {
    console.log(yellow('目前已綁定 2FA, 強制重新綁定前需要先解除既有的綁定'))
    const untied = await performUntie(api, payload)
    if (!untied) {
      errorConsole('既有 2FA 未能成功解除, 中止重新綁定')
      return
    }
  }

  console.log()
  console.log(lightBlue('取得新的綁定資訊 (QR code / secret)...'))
  const { error: bindError, data: bindData } = await api.bindNewGoogleDevice()
  if (bindError != null || bindData?.success !== true) {
    errorConsole('取得綁定資訊失敗: ', bindError ?? bindData?.msg)
    return
  }

  const totpKey = bindData?.data?.totpKey
  console.log(lightGreen('✅ 取得新的 2FA secret: '), totpKey)
  console.log('otpauth: ', bindData?.data?.qecode)

  console.log()
  console.log(lightBlue('發送 email 驗證碼 (綁定用)...'))
  const { error: sendError, data: sendData } = await api.requestEmailOtp(OTP_EMAIL_REQ_TYPE_BIND)
  if (sendError != null || sendData?.success !== true) {
    errorConsole('發送 email 驗證碼失敗: ', sendError ?? sendData?.msg)
    return
  }
  console.log(lightGreen('✅ email 驗證碼已發送, 請去收信'))

  const otpCodeEmail = await resolveEmailOtp({
    username: account?.username,
    email: payload.email,
    brandName: payload.brandName,
    purpose: 'BIND',
  })
  if (!otpCodeEmail) {
    errorConsole('沒有可用的 email 驗證碼, 中止')
    return
  }

  // 在最後一刻才算 TOTP code: 前面 email OTP 查詢 (可能有重試延遲) 都可能耗掉時間, 太早算會過期
  const code = await genFreshTotpCode(totpKey)
  console.log('📶 用新 secret 算出的 2FA code: ', code)

  const { error, data } = await api.newGoogleAuth({ code, totpKey, otpCodeEmail })
  if (error != null || data?.success !== true) {
    errorConsole('綁定失敗: ', error ?? data?.msg)
    return
  }
  console.log(lightGreen(`✅ ${data?.msg ?? '2FA 已重新綁定'}`))

  const shouldSave = await confirm({
    message: `是否要把新的 2FA secret 存回 settings.json 這個 profile (${blue(payload.email)})?`,
    default: true,
  }).catch(() => false)
  if (!shouldSave) return

  updateStoredSecret(payload, totpKey)
  console.log(lightGreen('✅ 已將新的 2FA secret 存回 settings.json'))
}

function updateStoredSecret(payload, newSecret) {
  const settings = loadSettings()
  const profiles = settings.loginProfiles ?? []
  const target = profiles.find((p) => p.email === payload.email && p.brandName === payload.brandName)

  if (target == null) {
    errorConsole('在 settings.json 裡找不到對應的 profile, 沒有存回去')
    return
  }

  target.secretCode2Fa = newSecret
  settings.loginProfiles = profiles
  saveSettings(settings)
  payload.secretCode2Fa = newSecret || null
}
