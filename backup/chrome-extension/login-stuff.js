// TODO(flyc): device fingerprint 看能不能自動生成和 browser 一樣的?

import jsSha3 from 'js-sha3'
import { get, post } from './request-stuff.js'
import { gen2FaCode } from './2fa.js'
import { showBase64Image } from './captcha-stuff.js'
const { sha3_256: Hash } = jsSha3

/**
 * 處理登入相關的類別，提供完整的登入流程管理，包含驗證碼驗證和二階段驗證(2FA)
 *
 * @class
 * @classdesc 統一管理登入流程所需的所有資訊和 API 方法：
 * - 處理基本登入驗證
 * - 處理驗證碼檢查
 * - 處理二階段驗證(2FA)
 * - 處理裝置驗證
 *
 * @param {Object} payload - 初始化所需的配置物件
 * @param {number} [payload.pk=Date.now()] - 主鍵，預設為當前時間戳
 * @param {string} payload.email - 使用者電子郵件（必填）
 * @param {string} payload.password - 使用者密碼（必填）
 * @param {string} [payload.secretCode2Fa] - 生成二階段驗證碼的密鑰
 * @param {string} [payload.current2FaCode] - 若無密鑰時的當前二階段驗證碼
 * @param {string} payload.brandName - 品牌名稱（必須通過 checkBrandName 驗證）
 * @param {string} [payload.token] - 登入令牌
 * @param {string} [payload.deviceFingerprint] - 裝置指紋
 *
 * @throws {Error} 當 email 或 password 為空時拋出錯誤
 * @throws {Error} 當 brandName 未通過 checkBrandName 驗證時拋出錯誤
 */
export class LoginNeeded {
  constructor(payload = {}) {
    const {
      pk = Date.now(),
      email,
      password,
      secretCode2Fa,
      current2FaCode,
      brandName,
      token,
      deviceFingerprint,
    } = payload

    if (email == null || password == null) {
      throw new Error(`[${this.constructor.name}] email 和 password 都為必填`)
    }

    this.brandName = brandName ?? null
    if (this.brandName && !LoginNeeded.checkBrandName.call(this, this.brandName)) {
      throw new Error(`[${this.constructor.name}] brandName: ${brandName} 沒通過 checkBrandName`)
    }

    this.pk = pk
    this.email = email
    this.password = password
    this.secretCode2Fa = secretCode2Fa ?? null
    this.current2FaCode = current2FaCode ?? null
    this.token = token ?? null
    this.deviceFingerprint = deviceFingerprint ?? null
  }

  static checkBrandName() {
    if (this.brandName == null) return false

    switch (this.brandName) {
      case 'lmex':
      case 'btse':
      case 'bitkub':
      case 'traiex':
      case 'paradise':
      case 'bitmarkets':
      case 'bitmarkets1':
      case 'b2z':
      case 'interpay':
      case 'trans':
      case 'bullstreetex':
      case 'btse-li':
      case 'btse-gi':
      case 'altex':
      case 'crypto':
      case 'btse-lt':
      case 'binoex':
      case 'nvx':
      case 'autotrader':
      case 'bitqik':
      case 'coinwise':
      case 'obot':
      case 'fedhabit':
      case 'btzo':
      case 'traxex':
        return true
    }

    return false
  }

  get websiteLink() {
    const websiteLink = `https://${this.brandName ?? 'staging'}.btse.co/en`

    // console.log(`🔗 websiteLink: ${websiteLink}`)

    return websiteLink
  }

  get apiBaseUrl() {
    let apiBaseUrl = `https://${this.brandName}-api.btse.co`
    if (this.brandName == null) {
      apiBaseUrl = 'https://api.btse.co'
    }

    // console.log(`🤙 apiBaseUrl: ${apiBaseUrl}`)

    return apiBaseUrl
  }

  loginApi(loginParams = {}) {
    const url = `${this.apiBaseUrl}/api/login`
    const formData = new FormData()

    formData.append('password', Hash(Hash(this.password)))
    formData.append('deviceFingerprint', this.deviceFingerprint)
    formData.append('loginName', this.email)
    formData.append('keepLogin', true)

    Object.keys(loginParams).forEach((key) => formData.append(key, loginParams[key]))

    return post(url, formData)
  }

  resendOtp(token) {
    const url = `${this.apiBaseUrl}/api/userDevice/verification`
    const deviceFingerprint = this.deviceFingerprint

    const formData = new FormData()
    formData.append('token', token)
    formData.append('deviceFingerprint', deviceFingerprint)

    const headers = { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }

    return post(url, new URLSearchParams(formData).toString(), headers)
  }

  getOtp(username) {
    const params = { username, brandName: this.brandName ?? '' }
    const queryString = new URLSearchParams(params).toString()
    return get(`http://localhost:9999/getOtp?${queryString}`)
  }

  getCaptchaImage() {
    const url = `${this.apiBaseUrl}/api/user/captcha/image`
    return get(url)
  }

  getCaptcha(captchaId) {
    const params = { captchaId }
    const queryString = new URLSearchParams(params).toString()
    return get(`http://localhost:9999/getCaptcha?${queryString}`)
  }

  // USER_DEVICE_CHECK_TOKEN_KEY_xxx
  // USER_2FA_DEVICE_CHECK_TOKEN_KEY_xxx
  static regexpDevice = /^USER_DEVICE_CHECK_TOKEN_KEY_/
  static regexp2Fa = /^USER_2FA_DEVICE_CHECK_TOKEN_KEY_/
  static regexpLoginToken = /^USER_2FA_LOGIN_TOKEN_KEY/

  finalPass({ deviceFingerprint, token, otpCode, code2Fa }) {
    const deviceOnlyUrl = `${this.apiBaseUrl}/api/user/check/userDevice`
    const passCodeUrl = `${this.apiBaseUrl}/api/user/check/2FA`

    const url = LoginNeeded.regexpDevice.test(token) ? deviceOnlyUrl : passCodeUrl

    const params = LoginNeeded.regexpDevice.test(token)
      ? { token, deviceFingerprint, passCode: otpCode }
      : { token, deviceFingerprint, otpCode: code2Fa, passCode: otpCode }
    const headers = { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }

    console.log('🔗 finall passd 的 url: ', url)

    return post(url, new URLSearchParams(params).toString(), headers)
  }

  async checkTokenHealth(token = this.token) {
    if (!token) {
      console.log('⚠️ 缺少 token，無法進行健康檢查')
      return { isHealthy: false, error: null }
    }

    try {
      const { error, data } = await get(`${this.apiBaseUrl}/api/user/userStatus`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const healthCheckResult = {
        isHealthy: !error && data?.success && data?.data === 'ONLINE',
        statusCode: data?.status,
        error,
      }

      return healthCheckResult
    } catch (error) {
      errorConsole('❌ Token 健康檢查失敗:', error)
      return { isHealthy: false, error: error.message }
    }
  }

  async otpFlow({ firstToken, username }) {
    titleConsole('需要 OTP')
    subTitleConsole(`重新寄送 OTP: `)
    const { error: resendError } = await this.resendOtp(firstToken)
    if (resendError != null) {
      errorConsole('在 resendError 發生錯誤', this)
      errorConsole(resendError)
      return { error: resendError }
    } else console.log('✅ 重新寄送 otp 成功')

    subTitleConsole(`嘗試從 redis 裡取得 OTP:`)
    const { error: redisError, data: { data: otpCode } = {} } = await this.getOtp(username)
    if (redisError != null || otpCode == null) {
      errorConsole('在 redisError 發生錯誤', this)
      errorConsole(redisError)
      return { error: redisError }
    } else console.log('✅ 取得 redis otp 成功')
    console.log('🕵️ otp: ', otpCode)
    return { otpCode }
  }

  '2faFlow'() {
    titleConsole('需要 2FA')
    subTitleConsole(`嘗試從 secret 計算出 2fa code:`)

    try {
      const code2Fa = function () {
        let code = ''
        if (this.secretCode2Fa != null) {
          code = gen2FaCode(this.secretCode2Fa)
          console.log('📶 2fa code:', code)
        } else if (this.current2FaCode != null) {
          code = this.current2FaCode
          console.log('📶 使用者提供的 2fa code:', code)
        } else {
          errorConsole('沒有足夠的資訊產生 2fa code')
          return null
        }

        return code
      }.call(this)
      return { code2Fa }
    } catch (e) {
      errorConsole(e)
      return { error: e }
    }
  }

  async healthCheckFlow() {
    titleConsole('健康檢查流程')
    subTitleConsole('👩‍⚕️ 開始執行既有 token 的健康檢查: ')

    const { token: currentToken } = this
    if (currentToken) {
      const { isHealthy, error } = await this.checkTokenHealth(currentToken)
      if (error) return { error }

      if (isHealthy) {
        console.log('  > 🏥 Token 健康檢查通過')
        tokenConsole('通過健康檢查的 token', currentToken)
        return { token: currentToken, websiteLink: this.websiteLink }
      } else console.log('🤕 Token 已失效，需要重新登入')
    } else {
      console.log('  > ❤️‍🩹 不存在既有 token, 不進行健康檢查')
    }

    return { isHealthy: false, error: null }
  }

  // loginProcess: 這邊會有 recursive 後取得的 captchaId 和 captchaNumber
  async loginProcess(otherPayload = {}) {
    const {
      error: loginError,
      data: { success, msg, data: { username, token: firstToken } = {} },
    } = await this.loginApi(otherPayload)
    if (loginError != null || !success) {
      if (msg === 'Wrong captcha code') {
        console.log('🏞️ 需要輸入 captcha')
        const { error: captchaError, data: captchaData } = await this.getCaptchaImage()
        if (captchaError != null) {
          errorConsole('在 get captcha 發生錯誤', this)
          errorConsole(captchaError ?? msg)
          return { error: captchaError }
        }
        const {
          data: { img, captchaId },
        } = captchaData
        await showBase64Image(img)

        // Get the captcha value from redis
        const { error: redisCaptchaError, data: { data: captchaNumber } = {} } = await this.getCaptcha(captchaId)
        if (redisCaptchaError != null || captchaNumber == null) {
          errorConsole('在取得 redis captcha 發生錯誤', this)
          errorConsole(redisCaptchaError)
          return { error: redisCaptchaError }
        }

        return this.loginProcess({ captchaId, captchaNumber })
      } else {
        errorConsole('在 loginError 發生錯誤', this)
        errorConsole(loginError ?? msg)
        return { error: loginError ?? msg }
      }
    } else console.log('✅ 登入成功')

    return { username, firstToken }
  }

  get LoginResult() {
    return class LoginResult {
      constructor({ error, token, websiteLink } = {}) {
        this.error = error
        this.token = token
        this.websiteLink = websiteLink
      }
    }
  }

  async login() {
    // 先檢查 token 是否健康
    const healthResult = await this.healthCheckFlow()
    if (healthResult.error != null) return new this.LoginResult({ error: '健康檢查的過程出錯了' })
    if (healthResult.isHealthy) return new this.LoginResult(healthResult)

    titleConsole(`開始登入流程: `)
    const { error: loginError, username, firstToken } = await this.loginProcess()
    if (loginError != null) return new this.LoginResult({ error: loginError })

    console.log('📧 email:', this.email)
    console.log('💂 username:', username)
    console.log('🔑 token:', firstToken)

    if (
      !LoginNeeded.regexpDevice.test(firstToken) && // 僅需要 deviceOTP
      !LoginNeeded.regexp2Fa.test(firstToken) && // 需要 2FA 和 deviceOTP
      !LoginNeeded.regexpLoginToken.test(firstToken) // 僅需要 2FA
    ) {
      tokenConsole('這個 token 已經可以用囉', firstToken)
      return new this.LoginResult({ token: firstToken, websiteLink: this.websiteLink })
    }

    // 如果有需要 deviceOTP 的話
    let otpCode = null
    if (!LoginNeeded.regexpLoginToken.test(firstToken)) {
      const { otpCode: resOtpCode, error: otpError } = await this.otpFlow({ firstToken, username })
      if (otpError != null) return new this.LoginResult({ error: otpError })
      otpCode = resOtpCode
    }

    // 如果有需要 2FA 的話
    let code2Fa = null
    if (!LoginNeeded.regexpDevice.test(firstToken)) {
      const { code2Fa: resCode2Fa, error: error2fa } = this['2faFlow']()
      if (error2fa != null) return new this.LoginResult({ error: error2fa })
      code2Fa = resCode2Fa
    }

    titleConsole(`正要開始最終驗證: `)
    const finalParams = {
      deviceFingerprint: this.deviceFingerprint,
      token: firstToken,
      otpCode,
      code2Fa: code2Fa || '999999',
    }
    console.log('最終驗證的參數:', JSON.stringify(finalParams))
    const { error: finalPassError, ...others } = await this.finalPass(finalParams)
    if (finalPassError != null || !others.data.success) {
      errorConsole('在 finalPassError 發生錯誤', this)
      errorConsole(finalPassError ?? others.data.msg)
      return new this.LoginResult({ error: finalPassError ?? others.data.msg })
    } else console.log('✅ 最終驗證成功')

    tokenConsole('收到的 token', others.data.data.token)

    return new this.LoginResult({ token: others.data.data.token, websiteLink: this.websiteLink })
  }
}

function errorConsole(...params) {
  console.log(`\x1b[1m\x1b[31m`, ...params, `\x1b[0m`)
}

function titleConsole(...params) {
  console.log(`\x1b[1m\x1b[34m`, ...params, `\x1b[0m`)
}

function subTitleConsole(...params) {
  console.log(`\x1b[34m`, ...params, `\x1b[0m`)
}

function tokenConsole(str, token) {
  console.log(`💖 ${str}: `, '\x1b[1m\x1b[43m', token, '\x1b[0m')
}
