import jsSha3 from 'js-sha3'
import { get, post } from './request-stuff.js'
import { gen2FaCode } from './2fa.js'
import { showBase64Image } from './captcha-stuff.js'
const { sha3_256: Hash } = jsSha3
import { input } from '@inquirer/prompts'

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

    this.brandName = brandName
    if (!LoginNeeded.checkBrandName.call(this, brandName)) {
      throw new Error(`[${this.constructor.name}] brandName 沒通過 checkBrandName`)
    }

    this.pk = pk
    this.email = email
    this.password = password
    this.secretCode2Fa = secretCode2Fa ?? null
    this.current2FaCode = current2FaCode ?? null
    this.token = token ?? null
    this.deviceFingerprint = deviceFingerprint ?? '_wpqeke1744701766089'
  }

  static checkBrandName() {
    if (this.brandName == null) return false

    switch (this.brandName) {
      case 'lmex':
      case 'bitkub':
      case 'traiex':
        return true
    }

    // TODO(flyc): 白牌的 mapping 表
    return false
  }

  get websiteLink() {
    switch (this.brandName) {
      case 'lmex':
        return 'https://lmex.btse.co/en'
      case 'bitkub':
        return 'https://bitkub.btse.co/en'
      case 'traiex':
        return 'https://traiex.btse.co/en'
    }

    console.error(`[${this.constructor.name}]websiteLink 匹配失敗`, this.brandName)
    return ''
  }

  get apiBaseUrl() {
    switch (this.brandName) {
      case 'lmex':
        return 'https://lmex-api.btse.co'
      case 'bitkub':
        return 'https://bitkub-api.btse.co'
      case 'traiex':
        return 'https://traiex-api.btse.co'
    }

    console.error(`[${this.constructor.name}]apiBaseUrl 匹配失敗`, this.brandName)
    return ''
  }

  loginApi(otherPayload = {}) {
    const url = `${this.apiBaseUrl}/api/login`
    const formData = new FormData()

    formData.append('password', Hash(Hash(this.password)))
    formData.append('deviceFingerprint', this.deviceFingerprint)
    formData.append('loginName', this.email)
    formData.append('keepLogin', true)

    Object.keys(otherPayload).forEach((key) => formData.append(key, otherPayload[key]))

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

  getOtp(username, brandName) {
    const params = { username, brandName }
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

  finalPass({ token, otpCode, passCode }) {
    const deviceOnlyUrl = `${this.apiBaseUrl}/api/user/check/userDevice`
    const passCodeUrl = `${this.apiBaseUrl}/api/user/check/2FA`

    const url = LoginNeeded.regexpDevice.test(token) ? deviceOnlyUrl : passCodeUrl
    const deviceFingerprint = this.deviceFingerprint

    const params = LoginNeeded.regexpDevice.test(token)
      ? { token, deviceFingerprint, passCode: otpCode }
      : { token, deviceFingerprint, otpCode, passCode }
    const headers = { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }

    console.log('🔗 finall passd 的 url: ', url)

    return post(url, new URLSearchParams(params).toString(), headers)
  }

  /**
   * 處理完整的登入流程
   *
   * @async
   * @param {import('.').LoginNeeded} payload - LoginNeeded 實例
   * @returns {Promise<{token: string, websiteLink: string}|void>}
   *          成功時返回包含最終令牌和網站連結的物件，失敗時返回 void
   * @throws {Error} 當 payload 不是 LoginNeeded 類別的實例時拋出錯誤
   */
  async login(payload) {
    if (!(payload instanceof LoginNeeded)) throw new Error('要是 LoginNeeded instance')

    // TODO(flyc): 這邊要做 health check
    const { token: currentToken } = payload ?? {}
    !console && currentToken

    /**
     * 處理登入流程，包含驗證碼驗證和 2FA 認證
     * @param {LoginNeeded} payload - LoginNeeded 實例，包含登入憑證和方法
     * @param {Object} payload.email - 用戶電子郵件
     * @param {string} payload.brandName - 用於獲取 OTP 的品牌名稱
     * @param {string} [payload.secretCode2Fa] - 生成 2FA 的密鑰
     * @param {string} [payload.current2FaCode] - 若無密鑰時的當前 2FA 代碼
     * @param {string} payload.websiteLink - 網站 URL
     * @param {Function} payload.loginApi - 初始登入的 API 方法
     * @param {Function} payload.getCaptchaImage - 獲取驗證碼圖片的 API 方法
     * @param {Function} payload.resendOtp - 重新發送 OTP 的 API 方法
     * @param {Function} payload.getOtp - 從 redis 獲取 OTP 的 API 方法
     * @param {Function} payload.finalPass - 最終認證的 API 方法
     * @throws {Error} 如果 payload 不是 LoginNeeded 實例則拋出錯誤
     * @returns {Promise<{token: string, websiteLink: string}|void>} 成功時返回 token 和網站連結，失敗時返回 void
     *
     * @example
     * const loginPayload = new LoginNeeded({
     *   email: 'user@example.com',
     *   brandName: 'brand',
     *   // ... 其他必要屬性
     * });
     * const result = await login(loginPayload);
     *
     * @description 內部 _login 函數接受:
     * @param {Object} [otherPayload] - 額外的驗證碼相關資料
     * @param {string} [otherPayload.captchaId] - 驗證碼 ID
     * @param {string} [otherPayload.captchaNumber] - 用戶輸入的驗證碼
     */
    async function _login(otherPayload = {}) {
      // TODO(flyc): login 可以整理一下
      const {
        error: loginError,
        data: { success, msg, data: { username, token: firstToken } = {} },
      } = await payload.loginApi(otherPayload)
      if (loginError != null || !success) {
        if (msg === 'Wrong captcha code') {
          console.log('🏞️ 需要輸入 captcha')
          const { error: captchaError, data: captchaData } = await payload.getCaptchaImage()
          if (captchaError != null) {
            console.error('在 get captcha 發生錯誤', payload)
            console.error(captchaError ?? msg)
            return { error: captchaError }
          }
          const {
            data: { img, captchaId },
          } = captchaData
          await showBase64Image(img)

          // Get the captcha value from redis using the new API
          const { error: redisCaptchaError, data: { data: captchaNumber } = {} } = await payload.getCaptcha(captchaId)
          if (redisCaptchaError != null || captchaNumber == null) {
            console.error('在取得 redis captcha 發生錯誤', payload)
            console.error(redisCaptchaError)
            return { error: redisCaptchaError }
          }

          return _login({ captchaId, captchaNumber })
        } else {
          console.error('在 loginError 發生錯誤', payload)
          console.error(loginError ?? msg)
          return { error: loginError ?? msg }
        }
      } else console.log('✅ 登入成功')

      return { username, firstToken }
    }

    console.log(`⁉️ 正要開始嘗試登入: `)
    const { error: loginError, username, firstToken } = await _login()
    if (loginError != null) return

    console.log('📧 email:', payload.email)
    console.log('💂 username:', username)
    console.log('🔑 token:', firstToken)

    // TODO(flyc): 這個的檢查可以調整一下
    if (
      !LoginNeeded.regexpDevice.test(firstToken) &&
      !LoginNeeded.regexp2Fa.test(firstToken) &&
      !LoginNeeded.regexpLoginToken.test(firstToken)
    ) {
      console.log('🗝️ 這個 token 已經可以用囉')
      return { token: firstToken, websiteLink: payload.websiteLink }
    }

    console.log()
    console.log(`⁉️ 正要開始重新寄送 OTP: `)
    const { error: resendError } = await payload.resendOtp(firstToken)
    if (resendError != null) {
      console.error('在 resendError 發生錯誤', payload)
      return void console.error(resendError)
    } else console.log('✅ 重新寄送 otp 成功')

    console.log()
    console.log(`⁉️ 正要開始嘗試從 redis 裡取得 OTP:`)
    const { error: redisError, data: { data: redisData } = {} } = await payload.getOtp(username, payload.brandName)
    if (redisError != null || redisData == null) {
      console.error('在 redisError 發生錯誤', payload)
      return void console.error(redisError)
    } else console.log('✅ 取得 redis otp 成功')

    console.log('🕵️ otp: ', redisData)

    console.log()
    console.log(`⁉️ 正要開始嘗試取得 2fa code:`)
    const code2Fa = (function () {
      let code = ''
      if (payload.secretCode2Fa != null) {
        code = gen2FaCode(payload.secretCode2Fa)
        console.log('📶 2fa code:', code)
      } else if (payload.current2FaCode != null) {
        code = payload.current2FaCode
        console.log('📶 使用者提供的 2fa code:', code)
      } else {
        console.error('沒有足夠的資訊產生 2fa code')
        return void 0
      }

      return code
    })()

    if (code2Fa == null) return

    console.log()
    console.log(`⁉️ 正要開始最終驗證: `)
    const { error: finalPassError } = await payload.finalPass({ token: firstToken, otpCode: redisData, passCode: code2Fa })
    if (finalPassError != null) {
      console.error('在 finalPassError 發生錯誤', payload)
      return void console.error(finalPassError)
    } else console.log('✅ 最終驗證成功')

    return { token: firstToken, websiteLink: payload.websiteLink }
  }
}
