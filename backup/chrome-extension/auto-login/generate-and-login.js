import { loadSettings } from './settings-loader.js'
import { input, select } from '@inquirer/prompts'
import { errorConsole, loginDisposable, subTitleConsole, titleConsole } from './t99-utils.js'
import { blue, lightGreen, lightYellow } from '../color.js'
import { LoginNeeded } from './login-stuff.js'
import { RegistrationNeeded, updateCacheFile, updateSettingsFile } from './register-stuff.js'

const EMAIL_DOMAIN = 'mailto.plus'
const DEFAULT_PASSWORD = '!QAZ1qaz'

// 生成 (註冊) + 自動登入某個 brand:
// 選 brand -> 輸入 email 前綴 -> 註冊 (失敗可重輸前綴或結束) -> 寫回 settings.json -> 自動登入
export async function generateAndLogin() {
  const config = { getRedisBy: 'disposableFn' }
  let allWl = {}
  try {
    const settings = loadSettings()
    allWl = settings?.['brand-list'] ?? {}
    config.allWl = allWl
    config.redis = settings?.redis
  } catch (error) {
    return void errorConsole(error.message)
  }

  const brandNames = Object.keys(allWl).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  if (brandNames.length === 0) {
    return void errorConsole('在 settings.json 中找不到 `brand-list` 或列表為空，請檢查設定檔。')
  }

  const brandName = await select({
    message: '要生成 + 登入哪個 brand?',
    choices: brandNames.map((name) => ({ name, value: name })),
    loop: false,
    pageSize: 15,
  }).catch(() => null)
  if (brandName == null) return void errorConsole('使用者取消')

  console.log()
  console.log(lightYellow('⚠️  注意: 對啟用 Geetest 的 brand (例如 btse) 此功能會失敗.'))
  console.log(lightYellow('    後端要 passToken (瀏覽器解 challenge 才拿得到), 純 API 繞不過去.'))
  console.log()

  // 失敗時只重新輸入前綴, brand 沿用
  while (true) {
    const prefix = await input({
      message: `請輸入 email 前綴 ({前綴}@${EMAIL_DOMAIN}):`,
      validate: (value) => (value && value.trim() !== '') || '請輸入 email 前綴',
    }).catch(() => null)
    if (prefix == null) return void errorConsole('使用者取消')

    const email = `${prefix.trim()}@${EMAIL_DOMAIN}`
    const account = { brandName, email, password: DEFAULT_PASSWORD, secretCode2Fa: '' }

    console.log()
    titleConsole(`開始註冊: ${email} (brand: ${brandName})`)
    console.log()

    let token = null
    try {
      const registration = new RegistrationNeeded(account, config)
      const signUpResponse = await registration.register()
      token = signUpResponse?.data?.data?.token
      if (!token) throw new Error('註冊成功，但未在 Response 中找到 token')
    } catch (error) {
      errorConsole(`註冊失敗: ${error.message}`)
      console.log()
      const next = await select({
        message: '接下來要做什麼?',
        choices: [
          { name: '重新輸入一個前綴再試一次', value: 'retry' },
          { name: '結束流程', value: 'end' },
        ],
      }).catch(() => 'end')
      if (next === 'retry') {
        console.log()
        continue
      }
      return void errorConsole('使用者結束流程')
    }

    console.log(lightGreen(`✅ 註冊成功: ${email}`))
    console.log()

    // 準備寫回 settings.json 的 profile, 並用同一份資料建立 LoginNeeded
    const displayName = `${brandName}-${prefix.trim()}`
    const profile = { displayName, brandName, email, password: DEFAULT_PASSWORD, secretCode2Fa: '' }
    const loginNeeded = new LoginNeeded({ ...profile, config })

    // 把剛註冊拿到的 token 先寫進 cache (用 LoginNeeded 的 potentialPk),
    // 這樣接下來的自動登入走 health check 就能直接沿用, 不用再重登一次
    await updateCacheFile([
      { token, potentialPk: loginNeeded.potentialPk, deviceFingerprint: loginNeeded.deviceFingerprint },
    ])

    // 把成功註冊的帳號寫回 settings.json 的 loginProfiles
    await updateSettingsFile([profile])

    // 自動登入 (開對應的 staging 頁面)
    console.log()
    subTitleConsole('🚀 開始自動登入...')
    await loginDisposable(loginNeeded, { port: null }).catch((err) => {
      errorConsole('登入時發生錯誤:', err?.message ?? err)
      if (err?.stack) errorConsole(err.stack)
    })
    return
  }
}
