import { loadSettings, saveSettings } from './settings-loader.js'
import { confirm, select } from '@inquirer/prompts'
import { blue, lightCyan, lightGreen, red, lightYellow } from '../color.js'
import { errorConsole, subTitleConsole, titleConsole } from './t99-utils.js'
import { connectRedis } from './redis.js'
import { WL } from './WL.js'
import jsSha3 from 'js-sha3'
import { post } from './request-stuff.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const { sha3_256: Hash } = jsSha3
const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const cacheFolder = path.resolve(dirname, 'cache')
const cacheFilePath = path.resolve(cacheFolder, 'cache.json')
const settingsFilePath = path.resolve(dirname, '..', 'settings.json')

// This logic is copied from login-stuff.js to ensure consistency
const genMockFingerprint = (oriPayload) => {
  const payload = { ...oriPayload }
  const keys = ['brandName', 'email', 'password', 'secretCode2Fa']
  const keychain = keys
    .map((key) => payload[key] ?? null)
    .filter(Boolean)
    .join('-')
  const fingerprintNumber = Hash(keychain)
    .replace(/[^0-9]/g, '')
    .slice(0, 13)
  const fingerprintPrefix = Hash(keychain).replace(/\d/g, '').slice(0, 5)
  return `_${fingerprintPrefix}${fingerprintNumber}`
}

class RegistrationNeeded {
  constructor(account, config) {
    if (!account.email || !account.password) {
      throw new Error('註冊物件缺少 email 或 password 屬性')
    }

    this.email = account.email
    this.password = account.password
    this.brandName = account.brandName ?? null
    this.secretCode2Fa = account.secretCode2Fa ?? ''
    this.config = config

    this.deviceFingerprint = genMockFingerprint(account)
    this.wl = new WL(this.brandName, this.config.allWl)
    this.sha256Password = Hash(Hash(this.password))
    const emailPrefix = this.email.split('@')[0]
    this.userName = `${emailPrefix}${this.brandName}stg`
  }

  get potentialPk() {
    return `${this.brandName}-${this.email}-${this.password}-${this.secretCode2Fa}-${this.deviceFingerprint}`
  }

  async register() {
    const redis = connectRedis()
    try {
      const apiUrl = this.wl.getApiUrl()

      // Step 1: Pre-registration call to get OTP sent
      const preRegUrl = `${apiUrl}/api/v2/user/otpEmail`
      console.log(lightCyan(`[${this.email}] 步驟 1: 請求 OTP -> ${preRegUrl}`)) // Keep this line
      const preRegFormData = new FormData()
      preRegFormData.append('lang', 'en')
      preRegFormData.append('password', this.sha256Password)
      preRegFormData.append('deviceFingerprint', this.deviceFingerprint)
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
      console.log(lightCyan(`[${this.email}] 步驟 3: 最終註冊 -> ${signUpUrl}`)) // Keep this line
      const signUpFormData = new FormData()
      signUpFormData.append('userName', this.userName)
      signUpFormData.append('email', this.email)
      signUpFormData.append('referralCode', '')
      signUpFormData.append('password', this.sha256Password)
      signUpFormData.append('otpCode', otpCode)
      signUpFormData.append('lang', 'en')
      signUpFormData.append('deviceFingerprint', this.deviceFingerprint)

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
  }
}

async function updateCacheFile(accountsToCache) {
  if (accountsToCache.length === 0) return

  try {
    titleConsole('正在更新 Cache 檔案...')
    const cacheFileContent = fs.readFileSync(cacheFilePath, 'utf8')
    const cacheData = JSON.parse(cacheFileContent)

    for (const account of accountsToCache) {
      const cacheKey = account.potentialPk
      cacheData[cacheKey] = {
        token: account.token,
        deviceFingerprint: account.deviceFingerprint,
        isInProgress: false,
        inProgressTimestamp: null,
        inProgressToken: null,
      }
    }

    fs.writeFileSync(cacheFilePath, JSON.stringify(cacheData, null, 2), 'utf8')
    console.log(lightGreen('✅ Cache 檔案更新成功!'))
  } catch (error) {
    errorConsole('更新 Cache 檔案失敗:', error.message)
  }
}

async function updateSettingsFile(profilesToAdd) {
  if (profilesToAdd.length === 0) return

  try {
    titleConsole('正在更新 Settings 檔案...')
    // Note: settings-loader does not have a direct read, so we read it manually
    const settingsFileContent = fs.readFileSync(settingsFilePath, 'utf8')
    const settingsData = JSON.parse(settingsFileContent)

    settingsData.loginProfiles = settingsData.loginProfiles || []
    settingsData.loginProfiles.push(...profilesToAdd)

    fs.writeFileSync(settingsFilePath, JSON.stringify(settingsData, null, 2), 'utf8')
    console.log(lightGreen('✅ Settings 檔案更新成功!'))
  } catch (error) {
    errorConsole('更新 Settings 檔案失敗:', error.message)
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
  const successfulAccountsForCache = []
  const successfulProfilesForSettings = []

  for (const account of config.registrationList) {
    try {
      const registration = new RegistrationNeeded(account, config)
      const signUpResponse = await registration.register()
      const token = signUpResponse?.data?.data?.token

      if (!token) {
        throw new Error('註冊成功，但未在 Response 中找到 token')
      }

      successes.push({ email: account.email, result: '註冊成功' })

      // Prepare data for file updates
      successfulAccountsForCache.push({
        token,
        potentialPk: registration.potentialPk,
        deviceFingerprint: registration.deviceFingerprint,
      })

      const emailPrefix = account.email.split('@')[0]
      successfulProfilesForSettings.push({
        displayName: `${account.brandName}-${emailPrefix}`,
        brandName: account.brandName,
        email: account.email,
        password: account.password,
        secretCode2Fa: '',
      })
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

  console.log() // Newline for separation

  // Update cache file automatically for successes
  await updateCacheFile(successfulAccountsForCache)

  // Ask user if they want to update settings
  if (successfulProfilesForSettings.length > 0) {
    console.log()
    const saveToProfiles = await select({
      message: '要把這次成功註冊的帳號資訊存入快速登入的清單 (settings.json-example) 嗎?',
      choices: [
        { name: '是', value: true },
        { name: '否', value: false },
      ],
    })

    if (saveToProfiles) {
      await updateSettingsFile(successfulProfilesForSettings)
    } else {
      console.log(lightYellow('已略過更新 Settings 檔案。'))
    }
  }
}
