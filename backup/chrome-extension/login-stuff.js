import jsSha3 from 'js-sha3'
import { get, post } from './request-stuff.js'
import { gen2FaCode } from './2fa.js'
import { showBase64Image } from './captcha-stuff.js'
const { sha3_256: Hash } = jsSha3
import { input } from '@inquirer/prompts'

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
}

export async function login(payload) {
  if (!(payload instanceof LoginNeeded)) throw new Error('要是 LoginNeeded instance')

  // TODO(flyc): 這邊要做 health check
  const { token: currentToken } = payload ?? {}
  !console && currentToken

  // TODO(flyc): login 可以整理一下
  async function _login(otherPayload = {}) {
    const {
      error: loginError,
      data: { success, msg, data: { username, token: firstToken } = {} },
    } = await payload.loginApi(otherPayload)
    if (loginError != null || !success) {
      if (msg === 'Wrong captcha code') {
        console.log('🏞️ 需要輸入 captcha')
        const { error: captchaError, data: captcahData } = await payload.getCaptchaImage()
        if (captchaError != null) {
          console.error('在 get captcha 發生錯誤', payload)
          console.error(captchaError ?? msg)
          return { error: captchaError }
        }
        const {
          data: { img, captchaId },
        } = captcahData
        await showBase64Image(img)
        const captchaNumber = await input({ message: '請輸入驗證碼: ' }).catch(() => null)

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
      console.log('💻 取得 2Fa 成功: ', code)
    } else if (payload.current2FaCode != null) {
      code = payload.current2FaCode
      console.log('💻 沒有 2fa 的 secretCode, 直接使用 current2FaCode(可能會因為時間改變)')
    } else {
      console.log('❤️‍🔥 沒有 2fa 的 secretCode, 也沒有 current2FaCode ')
    }

    return code
  })()

  console.log()
  console.log(`⁉️ 正要開始最後的登入嘗試:`)
  const {
    error: finalError,
    data: { success: finalSucces, msg: finalMsg, data: { token: finalToken } = {} },
  } = await payload.finalPass({
    token: firstToken,
    otpCode: redisData,
    passCode: code2Fa,
  })
  if (finalError != null || !finalSucces) {
    console.error('在 final 發生錯誤', payload)
    return void console.error(finalError ?? finalMsg)
  } else console.log('🐦‍🔥 登入成功')

  console.log('finalToken:', finalToken)
  return { token: finalToken, websiteLink: payload.websiteLink }
}
