// TODO(flyc): device fingerprint 看能不能自動生成和 browser 一樣的?
// TODO(flyc): 如果在使用者沒有傳入 secretCode 但是又需要 2FA 的時候，要可以讓使用者輸入

import jsSha3 from 'js-sha3'
import { get, post, Response } from './request-stuff.js'
import { gen2FaCode } from './2fa.js'
import { showBase64Image } from './captcha-stuff.js'
import { connectRedis } from './redis.js'
import { errorConsole, subTitleConsole, tokenConsole } from './t99-utils.js'
import { loadSettings } from './settings-loader.js'
import { blue, green, lightBlue, lightCyan, lightGreen } from '../color.js'

const { sha3_256: Hash } = jsSha3

// 這個看起來是有格式的，不能隨意調整
const genMockFingerprint = (oriPayload) => {
  const payload = { ...oriPayload } // TODO(flyc): 還要查說為什麼會多這一手? 如果沒有複製的話會出錯

  const keys = ['brandName', 'email', 'password', 'secretCode2Fa']
  const keychain = keys
    .map((key) => payload[key] ?? null)
    .filter(Boolean)
    .join('-')

  const fingerprintNumber = Hash(keychain).replace(/[^\d]/g, '').slice(0, 13)
  const fingerprintPrefix = Hash(keychain).replace(/\d/g, '').slice(0, 5)
  const fingerprint = `_${fingerprintPrefix}${fingerprintNumber}`

  return fingerprint
  // return `_ompzy${Date.now()}`
}

export class CacheInstance {
  static inProgressExpiredDuration = 1000 * 60 * 5

  constructor(cache, instancePayload) {
    this.token = cache?.token ?? null
    this.deviceFingerprint = cache?.deviceFingerprint
      ? cache.deviceFingerprint
      : (instancePayload?.deviceFingerprint ?? genMockFingerprint(instancePayload))
    this.isInProgress = cache?.isInProgress ?? false // 是否正在進行登入流程: 可能是 2FA 或 OTP 失效等
    this.inProgressTimestamp = cache?.inProgressTimestamp ?? null // 正在進行登入流程的 timestamp
    this.inProgressToken = cache?.inProgressToken ?? null // 正在進行登入流程的 token
  }

  update(payload) {
    this.token = payload?.token ?? this.token
    this.deviceFingerprint = payload?.deviceFingerprint ? payload?.deviceFingerprint : this.deviceFingerprint
    this.isInProgress = payload?.isInProgress ?? this.isInProgress
    this.inProgressTimestamp = payload?.inProgressTimestamp ?? this.inProgressTimestamp
    this.inProgressToken = payload?.inProgressToken ?? this.inProgressToken
  }
}

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

      isInProgress,
      inProgressTimestamp,
      inProgressToken,

      config: oriConfig = null,
    } = payload
    const config = new this.#ConfigInstance(oriConfig)

    if (email == null || password == null) {
      throw new Error(`[${this.constructor.name}] email 和 password 都為必填`)
    }

    this.brandName = brandName ?? null
    if (!LoginNeeded.checkBrandName.call(this, this.brandName)) {
      throw new Error(`[${this.constructor.name}] brandName: ${brandName} 沒通過 checkBrandName`)
    }

    this.pk = pk
    this.email = email
    this.password = password
    this.secretCode2Fa = secretCode2Fa ?? null
    this.current2FaCode = current2FaCode ?? null
    this.token = token ?? null
    this.deviceFingerprint = deviceFingerprint ? deviceFingerprint : genMockFingerprint(payload)

    this.isInProgress = isInProgress ?? false
    this.inProgressTimestamp = inProgressTimestamp ?? null
    this.inProgressToken = inProgressToken ?? null

    this.config = config
  }

  #brandMap = loadSettings()['brand-list'] ?? {}

  get brandMap() {
    return this.#brandMap
  }

  get brandInfo() {
    if (this.brandName == null) return null
    return this.brandMap[this.brandName] ?? null
  }

  mergeCache(cacheInstance) {
    if (!(cacheInstance instanceof CacheInstance)) {
      throw new Error(`[${this.constructor.name}] mergeCache: cacheInstance 必須是 CacheInstance 的實例`)
    }

    this.token = cacheInstance.token ?? this.token
    this.deviceFingerprint = cacheInstance.deviceFingerprint || this.deviceFingerprint

    this.isInProgress = cacheInstance.isInProgress ?? this.isInProgress
    this.inProgressTimestamp = cacheInstance.inProgressTimestamp ?? this.inProgressTimestamp
    this.inProgressToken = cacheInstance.inProgressToken ?? this.inProgressToken
  }

  get potentialPk() {
    return `${this.brandName}-${this.email}-${this.password}-${this.secretCode2Fa}-${this.deviceFingerprint}`
  }

  static checkBrandName() {
    if (this.brandName == null) return false

    const settings = loadSettings()
    const brandList = settings['brand-list'] ?? {}
    return this.brandName in brandList
  }

  get websiteLink() {
    // TODO(flyc): 這邊可以改成去取 frontend repo 的 yaml 檔
    const domainPrefix = (() => {
      switch (this.brandName) {
        case 'btse':
          return 'staging'

        case 'btsegi':
          return 'btse-gi'

        case 'bullstreet':
          return 'bullstreetex'

        case 'btseag':
          return 'btse-li'

        case 'btseuab':
          return 'btse-lt'

        case 'transexchange':
          return 'trans-exchange'

        default:
          return this.brandName
      }
    })()

    const websiteLink = `https://${domainPrefix}.btse.co/en`

    console.log(`🔗 websiteLink: ${websiteLink}`)

    return websiteLink
  }

  get apiBaseUrl() {
    const apiBaseUrl = this.brandInfo?.API_URL ?? null

    if (apiBaseUrl == null || apiBaseUrl === '') {
      errorConsole('取得 apiBaseUrl 失敗!')
      return null
    }

    // console.log(`\n🤙 apiBaseUrl: ${apiBaseUrl}`)
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

    console.log('登入的 formData:', formData)

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

  async getOtp(username) {
    const params = { username, brandName: this.brandName ?? '' }

    switch (this.config.getRedisBy) {
      case 'api': {
        const queryString = new URLSearchParams(params).toString()
        return get(`http://localhost:9999/getOtp?${queryString}`)
      }

      case 'disposableFn': {
        const redis = connectRedis()

        const { error, value } = await redis.getOtp(params.username, { brandName: params.brandName })
        redis.disconnect()

        return new Response({ error, data: { data: value } })
      }
    }
  }

  getCaptchaImage() {
    const url = `${this.apiBaseUrl}/api/user/captcha/image`
    return get(url)
  }

  async getCaptcha(captchaId) {
    const params = { captchaId }

    switch (this.config.getRedisBy) {
      case 'api': {
        const queryString = new URLSearchParams(params).toString()
        return get(`http://localhost:9999/getCaptcha?${queryString}`)
      }

      case 'disposableFn': {
        const redis = connectRedis()
        const { error, value } = await redis.getCaptcha(params.captchaId)
        redis.disconnect()

        return new Response({ error, data: { data: value } })
      }
    }
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
    console.log('final 的參數: ', params)

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
    lightBlue('需要 OTP')
    /*
    // TODO(flyc)
    // 這裡在重複登入的時候，會因為已經是用帳號密碼重新登入過一次了，所以 otp 會換，但 redis 裡的沒有同步到，所以會取到舊的.
    // 等到同一個 first-token 可以被重複使用的時候可以開回來試試看


    const { error: doGetOtpErrorFirstTry, otpCode: otpCodeFirstTry } = await _doGetOtp.call(this)
    if (doGetOtpErrorFirstTry != null) return { error: doGetOtpError }
    if (otpCodeFirstTry != null) return { otpCode: otpCodeFirstTry }
    */

    const { error: resendOtpError } = await _resendOtp.call(this)
    if (resendOtpError != null) return { error: resendOtpError }

    const { error: doGetOtpError, otpCode } = await _doGetOtp.call(this)
    if (doGetOtpError != null) return { error: doGetOtpError }

    console.log('🕵️ otp: ', otpCode)
    return { otpCode }

    async function _doGetOtp() {
      subTitleConsole(`嘗試從 redis 裡取得 OTP:`)
      const { error: redisError, data: { data: otpCode } = {} } = await this.getOtp(username)
      if (redisError != null || otpCode == null) {
        errorConsole('在 redisError 發生錯誤', this)
        errorConsole(redisError)
        return { error: redisError }
      } else console.log('✅ 取得 redis otp 成功: ', otpCode)
      return { otpCode }
    }

    async function _resendOtp() {
      subTitleConsole(`重新寄送 OTP: `)
      const { error: resendError } = await this.resendOtp(firstToken)
      if (resendError != null) {
        errorConsole('在 resendError 發生錯誤', this)
        errorConsole(resendError)
        return { error: resendError }
      } else {
        console.log('✅ 重新寄送 otp 成功')
        return { error: null }
      }
    }
  }

  '2faFlow'() {
    lightBlue('需要 2FA')
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
    lightBlue('健康檢查流程')
    subTitleConsole('👩‍⚕️ 開始執行既有 token 的健康檢查: ')

    const { token: currentToken } = this
    if (currentToken) {
      const { isHealthy, error } = await this.checkTokenHealth(currentToken)
      if (error) return { error }

      if (isHealthy) {
        console.log('  > 🏥 Token 健康檢查通過')
        tokenConsole('通過健康檢查的 token', currentToken)
        return { isHealthy: true, token: currentToken, websiteLink: this.websiteLink }
      } else console.log('🤕 Token 已失效，需要重新登入')
    } else {
      console.log('❤️‍🩹 不存在既有 token, 不進行健康檢查')
    }

    return { isHealthy: false, error: null }
  }

  // loginAccountPasswdCaptcha: 這邊會有 recursive 後取得的 captchaId 和 captchaNumber
  async loginAccountPasswdCaptcha(otherPayload = {}, { isRecursive = false } = {}) {
    if (!isRecursive) {
      console.log()
      console.log(blue('初次嘗試登入'))
    } else {
      console.log()
      console.log(blue('取得 captcha 後的再次登入'))
    }

    const result = await this.loginApi(otherPayload)
    const { error: loginError, data: originData } = result

    const {
      success: successFromSuccess,
      msg: successMessage,
      data: { username, token: firstToken } = {},
    } = originData ?? {}
    const { success: successFromError, msg: errorMessage } = loginError ?? {}

    const success = successFromSuccess ?? successFromError
    const msg = successMessage ?? errorMessage

    console.log('loginAccountPasswdCaptcha 的 response: ', result)
    console.log('loginAccountPasswdCaptcha 的 msg: ', msg)
    console.log('loginAccountPasswdCaptcha 的 success: ', success)

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
        console.log('📸 取得 captcha 成功: ')
        console.log('captchaId: ', captchaId)
        console.log('captchaNumber: ', captchaNumber)

        return this.loginAccountPasswdCaptcha({ captchaId, captchaNumber }, { isRecursive: true })
      } else {
        errorConsole('在 loginError 發生錯誤', this)
        errorConsole(loginError ?? msg)
        return { error: loginError ?? msg }
      }
    } else console.log(green('✅ 登入成功'))

    return { username, firstToken }
  }

  get LoginResult() {
    return class LoginResult {
      constructor(config) {
        this.error = config?.error ?? null
        this.token = config?.token ?? null
        this.websiteLink = config?.websiteLink ?? null

        this.isInProgress = config?.isInProgress ?? null
        this.inProgressTimestamp = config?.inProgressTimestamp ?? null
      }
    }
  }

  checkIsAlreadyOkToken(token) {
    if (LoginNeeded.regexpDevice.test(token)) return false // 僅需要 deviceFingerprint 的 token
    if (LoginNeeded.regexp2Fa.test(token)) return false // 需要 2fa code 和 deviceFingerprint 的 token
    if (LoginNeeded.regexpLoginToken.test(token)) return false // 僅需要 2fa code 的 token
    return true
  }

  // TODO(flyc): 應該要有 in progress 的機制，避免重複呼叫 login api 、重複寄送 otp 等等的那些
  // 盡量模擬使用者停留在輸入 otp 和 2fa 的那個畫面的場景
  // 判斷 isInProgress, 是的話判斷 token 是什麼類型的, 依照對應的類型執行對應的流程
  async login() {
    // 先檢查 token 是否健康
    const healthResult = await this.healthCheckFlow()
    if (healthResult.isHealthy) return new this.LoginResult(healthResult)

    if (healthResult.error != null) {
      console.log('健康檢查的流程出錯了，直接繼續過')
    }

    lightBlue(`開始登入流程: `)
    const { error: loginError, username, firstToken } = await this.loginAccountPasswdCaptcha()
    if (loginError != null) return new this.LoginResult({ error: loginError })

    console.log()
    console.log(lightCyan('取得的資訊'))
    console.log('📧 email:', blue(this.email))
    console.log('💂 username:', blue(username))
    console.log('🔑 token:', blue(firstToken))
    console.log()

    if (this.checkIsAlreadyOkToken(firstToken)) {
      tokenConsole('這個 token 已經可以用囉', firstToken)
      return new this.LoginResult({ token: firstToken, websiteLink: this.websiteLink })
    }

    // 如果有需要 deviceOTP 的話
    let otpCode = null
    if (!LoginNeeded.regexpLoginToken.test(firstToken)) {
      console.log(lightBlue('需要 OTP'))
      const { otpCode: resOtpCode, error: otpError } = await this.otpFlow({ firstToken, username })
      if (otpError != null) return new this.LoginResult({ error: otpError })
      otpCode = resOtpCode
    }

    // 如果有需要 2FA 的話
    let code2Fa = null
    if (!LoginNeeded.regexpDevice.test(firstToken)) {
      console.log(lightBlue('需要 2FA'))
      const { code2Fa: resCode2Fa, error: error2fa } = this['2faFlow']()
      if (error2fa != null) return new this.LoginResult({ error: error2fa })
      code2Fa = resCode2Fa
    }

    console.log()
    console.log(lightBlue(`正要開始最終驗證: `))
    const finalParams = {
      deviceFingerprint: this.deviceFingerprint,
      token: firstToken,
      otpCode,
      code2Fa: code2Fa || '999999',
    }
    console.log('最終驗證的參數:', finalParams)
    const { error: finalPassError, ...others } = await this.finalPass(finalParams)
    if (finalPassError != null || !others.data.success) {
      errorConsole('在 finalPassError 發生錯誤', this)
      errorConsole(finalPassError ?? others.data.msg)
      return new this.LoginResult({ error: finalPassError ?? others.data.msg })
    } else console.log(lightGreen('✅ 最終驗證成功'))

    console.log()
    tokenConsole('收到的 token', others.data.data.token)

    return new this.LoginResult({ token: others.data.data.token, websiteLink: this.websiteLink })
  }

  get #ConfigInstance() {
    return class ConfigInstance {
      static GET_REDIS_BY__ENUM = ['api', 'disposableFn']

      get GET_REDIS_BY__MAP() {
        return Object.fromEntries(this.constructor.GET_REDIS_BY__ENUM.map((key) => [key, true]))
      }

      errorMessage(type) {
        let message = ''
        switch (type) {
          case 'wrong-getRedisBy':
            message = ` 'getRedisBy' should be one of these following: ${this.constructor.GET_REDIS_BY__ENUM.join(', ')}`
            break
        }

        return `[${this.constructor.name}]${message}`
      }

      constructor(config) {
        const { getRedisBy = 'api' } = config ?? {}

        if (this.GET_REDIS_BY__MAP[getRedisBy] == null) {
          throw new Error(this.errorMessage('wrong-getRedisBy'))
        }

        this.getRedisBy = getRedisBy
      }
    }
  }
}
