import { loadSettings } from './settings-loader.js'
import { confirm } from '@inquirer/prompts'
import { blue, lightCyan, lightGreen, red } from '../color.js'
import { errorConsole, subTitleConsole, titleConsole } from './t99-utils.js'
import { connectRedis } from './redis.js'
import { WL } from './WL.js'
import jsSha3 from 'js-sha3'
import { post } from './request-stuff.js'

const { sha3_256: Hash } = jsSha3

class RegistrationNeeded {
  constructor(account, config) {
    if (!account.email || !account.password) {
      throw new Error('註冊物件缺少 email 或 password 屬性')
    }

    this.email = account.email
    this.password = account.password
    this.brandName = account.brandName ?? null
    this.config = config

    this.wl = new WL(this.brandName, this.config.allWl)
    this.sha256Password = Hash(Hash(this.password))
    // 從 email@domain.com 取出 email 當作 userName
    const emailPrefix = this.email.split('@')[0]
    this.userName = `${emailPrefix}${this.brandName}stg`
  }

  async register() {
    const redis = connectRedis()
    try {
      const apiUrl = this.wl.getApiUrl()

      // Step 1: Pre-registration call to get OTP sent
      const preRegUrl = `${apiUrl}/api/v2/user/otpEmail`
      console.log(lightCyan(`[${this.email}] 步驟 1: 請求 OTP -> ${preRegUrl}`))
      const preRegFormData = new FormData()
      preRegFormData.append('lang', 'en')
      preRegFormData.append('password', this.sha256Password)
      preRegFormData.append('deviceFingerprint', _genFingerprint())
      preRegFormData.append('email', this.email)
      preRegFormData.append('userName', this.userName)

      const preRegResponse = await post(preRegUrl, preRegFormData)
      if (preRegResponse.error) {
        const errorDetails = preRegResponse.error.message || JSON.stringify(preRegResponse.error)
        throw new Error(`請求 OTP 失敗: ${errorDetails}`)
      }
      console.log(lightGreen(`[${this.email}] 步驟 1: 請求 OTP 發送成功`))

      // Step 2: Get OTP from Redis
      console.log(lightCyan(`[${this.email}] 步驟 2: 從 Redis 獲取 OTP...`))
      const { value: otpCode, error: otpError } = await redis
        .getOtp(this.email, {
          brandName: this.brandName,
          type: 'SIGNUP',
        })
        .catch((err) => ({ error: err })) // catch promise rejection from getOtp
      if (otpError) {
        throw new Error(`從 Redis 獲取 OTP 失敗: ${otpError.message}`)
      }
      console.log(lightGreen(`[${this.email}] 步驟 2: 成功獲取 OTP: ${otpCode}`))

      // Step 3: Final registration call with OTP
      const signUpUrl = `${apiUrl}/api/v2/signup`
      console.log(lightCyan(`[${this.email}] 步驟 3: 最終註冊 -> ${signUpUrl}`))
      const signUpFormData = new FormData()
      signUpFormData.append('userName', this.userName)
      signUpFormData.append('email', this.email)
      signUpFormData.append('referralCode', '')
      signUpFormData.append('password', this.sha256Password)
      signUpFormData.append('otpCode', otpCode)
      signUpFormData.append('lang', 'en')
      signUpFormData.append('deviceFingerprint', _genFingerprint())

      const signUpResponse = await post(signUpUrl, signUpFormData)
      if (signUpResponse.error) {
        const errorDetails = signUpResponse.error.message || JSON.stringify(signUpResponse.error)
        throw new Error(`註冊失敗: ${errorDetails}`)
      }
      console.log(lightGreen(`[${this.email}] 步驟 3: 註冊成功!`))
      return signUpResponse
    } finally {
      redis.disconnect()
    }

    function _genFingerprint() {
      const prefix = crypto.randomUUID().replace(/-/g, '').match(/^.{5}/)[0]
      const date = Date.now()
      return `_${prefix}${date}`
    }
  }
}

export async function registerByList() {
  const config = {}
  try {
    const settings = loadSettings()
    config.registrationList = settings?.registrationList ?? []
    config.redis = settings?.redis
    config.allWl = settings?.['brand-list'] ?? {}
  } catch (error) {
    errorConsole(error.message)
    return
  }

  const { registrationList } = config
  if (!registrationList || registrationList.length === 0) {
    return errorConsole('在 settings.json 中找不到 `registrationList` 或列表為空，請檢查設定檔。')
  }

  const count = registrationList.length
  titleConsole(`偵測到 ${count} 個帳號準備註冊。`)
  console.log()

  const go = await confirm({ message: '是否開始進行批量註冊?' }).catch(() => null)
  if (!go) return void console.log(errorConsole('使用者取消'))
  console.log()

  const successes = []
  const failures = []

  for (const account of registrationList) {
    try {
      const registration = new RegistrationNeeded(account, config)
      const result = await registration.register()
      successes.push({ email: account.email, result: '註冊成功' })
    } catch (error) {
      failures.push({ email: account.email, error: error.message })
    }
    console.log() // Add a blank line for readability between accounts
  }

  titleConsole('✨ 批量註冊完成 ✨')
  console.log()

  if (successes.length > 0) {
    subTitleConsole('✅ 註冊成功列表:')
    successes.forEach((item) => {
      console.log(lightGreen(`  - ${item.email}: ${item.result}`))
    })
    console.log()
  }

  if (failures.length > 0) {
    subTitleConsole('❌ 註冊失敗列表:')
    failures.forEach((item) => {
      console.log(red(`  - ${item.email}: ${item.error}`))
    })
    console.log()
  }
}
