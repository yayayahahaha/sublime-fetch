import { loadSettings } from './settings-loader.js'
import { LoginNeeded } from './login-stuff.js'
import { errorConsole, loginDisposable, warnConsole } from './t99-utils.js'
import select, { Separator } from '@inquirer/select'
import { input, confirm } from '@inquirer/prompts'
import { generateBrandInfo } from './generate-brand-info.js'
import { loginStagingAdmin } from './login-staging-admin.js'
import { parseArgs } from './args-parser.js'
import { blue } from '../color.js'
import { clearEmailCache } from '../admin-related/admin-utils.js'
import { registerByList } from './register-stuff.js'
import { twoFaHelper } from './2fa-helper.js'

const GET_WHITELABEL_INFO = 'GET_WHITELABEL_INFO'
const REGISTER_BY_LIST = 'REGISTER_BY_LIST'
const LOGIN_STAGING_ADIN = 'LOGIN_STAGING_ADIN'
const CLEAR_EMAIL_CACHE = 'CLEAR_EMAIL_CACHE'
const TWO_FA_HELPER = 'TWO_FA_HELPER'

const supportedCmdArgs = ['port', 'profile']

start()
async function start() {
  const config = { getRedisBy: 'disposableFn' }
  const cmdArgs = parseArgs()

  Object.keys(cmdArgs).forEach((arg) => {
    if (!supportedCmdArgs.includes(arg)) warnConsole(`傳入了不支援的 args: ${arg}`)
  })

  let loginProfiles = []
  try {
    loginProfiles = loadSettings()?.loginProfiles ?? []
  } catch (error) {
    errorConsole(error.message)
    return
  }

  loginProfiles = loginProfiles
    .map((item, index) => {
      let displayName = item.displayName ?? `「動態生成的-display-name-${index + 0}」`

      if (item.displayName == null) {
        warnConsole(`👽警告👽 第 ${index} 個 profile 缺少 displayName, 將使用 ${displayName}\n`)
      }

      try {
        return {
          displayName,
          value: new LoginNeeded({ ...item, config }),
        }
      } catch (error) {
        errorConsole(`生成 profile 失敗: ${error.message}`)
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { numeric: true }))

  const profileMap = Object.fromEntries(loginProfiles.map((item) => [item.displayName, item.value]))

  // 檢查是否從命令列提供了 profile 參數
  let profileKey = null

  const answer = await select({
    message: '你要做什麼? ',
    choices: [
      {
        name: '重新生成 WL 的資訊',
        value: GET_WHITELABEL_INFO,
        description: '從 frontend repo 取得 WL 的 api path 等資訊',
      },
      {
        name: '2FA 助手',
        value: TWO_FA_HELPER,
        description: '讀取或生成 2FA Code',
      },
      new Separator(),
      {
        name: '批量註冊帳號',
        value: REGISTER_BY_LIST,
        description: '批量註冊帳號',
      },
      new Separator(),
      {
        name: '登入 Staging Admin',
        value: LOGIN_STAGING_ADIN,
        description: '登入 Staging 環境的 Admin 帳號',
      },
      {
        name: '清除 Email Staging 環境的 Cache',
        value: CLEAR_EMAIL_CACHE,
        description: '由於 Email 樣板是靜態資源，上完 Staging 後要手動清除 Cache',
      },
      new Separator(),
      ...loginProfiles.map((item) => ({ name: `${item.displayName}`, value: item.displayName })),
    ],
    loop: false,
  }).catch(() => null)
  if (answer == null) return void errorConsole('使用者取消')

  if (answer === GET_WHITELABEL_INFO) return void generateBrandInfo()
  if (answer === REGISTER_BY_LIST) return void registerByList()
  if (answer === LOGIN_STAGING_ADIN) return void loginStagingAdmin()
  if (answer === CLEAR_EMAIL_CACHE) return void clearEmailCache()
  
  if (answer === TWO_FA_HELPER) {
    await twoFaHelper()
    return // 直接結束
  }

  profileKey = answer

  // 檢查是否從命令行提供了 port 參數
  let port
  if (cmdArgs.port) {
    port = cmdArgs.port
    console.log(colorMessage(`使用命令行參數 port: ${port}`))
  } else {
    const portInput = await input({
      message: '請輸入 port 號, 沒輸入的話會開啟對應的 staging 頁面',
      default: null,
      validate(value) {
        if (value == null) return true
        const result = !value || /^\d+$/.test(value)
        return result || '請輸入正確的 port 號'
      },
    }).catch(() => ({ error: '使用者取消' }))
    if (portInput?.error != null) return void errorConsole(portInput?.error)
    port = portInput || null
  }

  console.log()
  console.log(colorMessage('選擇的 profile: '), profileKey)
  console.log(colorMessage('是否是開啟 localhost: '), !!port)
  !!port && console.log(colorMessage('localhost 的 port 號: '), port)
  console.log()

  const go = await confirm({ message: '開始登入囉?' }).catch(() => null)
  if (!go) return void errorConsole('使用者取消')
  console.log()

  const payload = profileMap[profileKey]
  if (payload == null) return errorConsole('沒有找到匹配的 profile:', profileKey)

  loginDisposable(payload, { port }).catch((err) => errorConsole('Error during login:', err))
}

function colorMessage(message) {
  return blue(message)
}
