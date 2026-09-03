import path from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'
import { errorConsole, loginDisposable, warnConsole } from './t99-utils.js'
import select, { Separator } from '@inquirer/select'
import { input, confirm } from '@inquirer/prompts'
import { generateBrandInfo } from './generate-brand-info.js'
import { loginStagingAdmin } from './login-staging-admin.js'
import { parseArgs } from './args-parser.js'
import { blue } from '../color.js'
import { clearEmailCache } from '../admin-related/admin-utils.js'
import { runDepositCli } from '../admin-related/deposit.js'
import { runAddRoleCli } from '../admin-related/add-role.js'
import { runGrantUserOpsAccessCli } from '../admin-related/grant-user-ops-access.js'
import { runResetUserOtpLimitCli } from '../admin-related/reset-user-otp-limit.js'
import { runBackfillProfileIdentifiersCli } from './backfill-profile-identifiers.js'
import { registerByList } from './register-stuff.js'
import { generateAndLogin } from './generate-and-login.js'
import { twoFaHelper } from './2fa-helper.js'
import { twoFaProfileHelper } from './2fa-profile-helper.js'
import { jiraBranchHelper } from './jira-helper.js'
import { chromeWindowHelper } from './refresh-tabs-helper.js'
import { operateRedis } from '../isolated-operate-redis/index.js'
import { mockServerMenu } from '../mock-server/index.js'
import { otpProxyMenu } from '../otp-proxy/index.js'
import { releaseCheckHelper } from '../release-check/index.js'
import { writeActionHelper, watchersHelper } from '../release-check/writeActions.js'
import { loadLoginProfiles } from './profile-loader.js'

const GET_WHITELABEL_INFO = 'GET_WHITELABEL_INFO'
const REGISTER_BY_LIST = 'REGISTER_BY_LIST'
const GENERATE_AND_LOGIN = 'GENERATE_AND_LOGIN'
const LOGIN_STAGING_ADIN = 'LOGIN_STAGING_ADIN'
const CLEAR_EMAIL_CACHE = 'CLEAR_EMAIL_CACHE'
const DEPOSIT_TO_USER = 'DEPOSIT_TO_USER'
const ADD_ROLE_TO_ADMIN = 'ADD_ROLE_TO_ADMIN'
const GRANT_USER_OPS_ACCESS = 'GRANT_USER_OPS_ACCESS'
const RESET_USER_OTP_LIMIT = 'RESET_USER_OTP_LIMIT'
const BACKFILL_PROFILE_IDENTIFIERS = 'BACKFILL_PROFILE_IDENTIFIERS'
const TWO_FA_HELPER = 'TWO_FA_HELPER'
const TWO_FA_PROFILE_HELPER = 'TWO_FA_PROFILE_HELPER'
const JIRA_BRANCH_HELPER = 'JIRA_BRANCH_HELPER'
const CHROME_WINDOW_HELPER = 'CHROME_WINDOW_HELPER'
const OPERATE_REDIS = 'OPERATE_REDIS'
const RUN_MOCK_SERVER = 'RUN_MOCK_SERVER'
const OTP_PROXY_SERVER = 'OTP_PROXY_SERVER'
const RELEASE_CHECK = 'RELEASE_CHECK'
const WRITE_MR = 'WRITE_MR'
const WRITE_PIPELINE = 'WRITE_PIPELINE'
const WRITE_JIRA_LINK = 'WRITE_JIRA_LINK'
const WATCHERS = 'WATCHERS'
const CONFIG_SERVER = 'CONFIG_SERVER'

const supportedCmdArgs = ['port', 'profile']
const dirname = path.dirname(fileURLToPath(import.meta.url))
const hatDevScriptPath = path.join(dirname, '..', 'scripts', 'hat-dev.sh')

start()
async function start() {
  const cmdArgs = parseArgs()

  Object.keys(cmdArgs).forEach((arg) => {
    if (!supportedCmdArgs.includes(arg)) warnConsole(`傳入了不支援的 args: ${arg}`)
  })

  let loginProfiles = []
  let profileMap = {}
  try {
    ;({ loginProfiles, profileMap } = loadLoginProfiles())
  } catch (error) {
    errorConsole(error.message)
    return
  }

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
      new Separator(),
      {
        name: 'Redis 對 Redis 操作',
        value: OPERATE_REDIS,
        description: '對 dev 或 staging 的 redis 做查找 or 刪除等',
      },
      {
        name: 'Mock Server 啟動有 mock api 的 server',
        value: RUN_MOCK_SERVER,
        description: '啟動 Mock Server',
      },
      {
        name: 'OTP Proxy Server 啟動 2FA / OTP 取碼 proxy',
        value: OTP_PROXY_SERVER,
        description: 'POST /get-otp：同時查 QA 的 payment/spot OTP，併上本地存的 2FA secret 算出的 code',
      },
      {
        name: '2FA 助手',
        value: TWO_FA_HELPER,
        description: '讀取、生成、編輯或刪除 2FA Code',
      },
      {
        name: 'Profile 2FA 操作',
        value: TWO_FA_PROFILE_HELPER,
        description: '選擇一個 loginProfile, 對它在網站上的 2FA 做讀取、移除或強制重新綁定',
      },
      {
        name: 'Profile 補齊 username',
        value: BACKFILL_PROFILE_IDENTIFIERS,
        description: '透過後台 userList 查詢, 幫 settings.json 裡缺 username 的 profile 批量補齊',
      },
      {
        name: 'Jira Branch 生成器',
        value: JIRA_BRANCH_HELPER,
        description: '透過 Jira 標題生成 Git Branch 名稱',
      },
      {
        name: 'Chrome 視窗助手',
        value: CHROME_WINDOW_HELPER,
        description: '列出 Chrome 視窗並執行刷新、複製 URL 或執行 JS',
      },
      {
        name: 'Release Check 版本檢查',
        value: RELEASE_CHECK,
        description: '依 Jira fix version 檢查各 repo 的 branch / 合併 / MR 狀態',
      },
      {
        name: '開 MR（GitLab）',
        value: WRITE_MR,
        description: '快速開 MR（目前：權限預檢；操作 UI 待接）',
      },
      {
        name: 'Pipeline（GitLab）',
        value: WRITE_PIPELINE,
        description: '觸發 / 排程 pipeline（目前：權限預檢；操作 UI 待接）',
      },
      {
        name: 'Jira 關聯單',
        value: WRITE_JIRA_LINK,
        description: '批量開 child 關聯單（目前：權限預檢；操作 UI 待接）',
      },
      {
        name: 'Watchers 背景監看任務',
        value: WATCHERS,
        description: '列出 / kill / 清除背景 pipeline 監看程序',
      },
      {
        name: 'Config Server 啟動 🎩 dev server',
        value: CONFIG_SERVER,
        description: 'checkout flyc/🎩-tree-skaking-with-claude, rebase 到 origin/develop^{commit} 後跑 yarn cm:dev',
      },
      new Separator(),
      {
        name: 'Register 批量註冊帳號',
        value: REGISTER_BY_LIST,
        description: '批量註冊帳號',
      },
      {
        name: 'Generate + Login 生成並自動登入某個 brand',
        value: GENERATE_AND_LOGIN,
        description: '選 brand + 輸入 email 前綴, 自動註冊後寫回 settings.json 並登入',
      },
      new Separator(),
      {
        name: 'Admin Login 登入 Staging Admin',
        value: LOGIN_STAGING_ADIN,
        description: '登入 Staging 環境的 Admin 帳號',
      },
      {
        name: 'Email Cache 清除 Email Staging 環境的 Cache',
        value: CLEAR_EMAIL_CACHE,
        description: '由於 Email 樣板是靜態資源，上完 Staging 後要手動清除 Cache',
      },
      {
        name: 'Deposit 儲值 USDT 給 user',
        value: DEPOSIT_TO_USER,
        description: '透過 Staging Admin 自動 deposit USDT 給指定 user (含切 role + approve)',
      },
      {
        name: 'Role add 幫 admin 帳號加 Role',
        value: ADD_ROLE_TO_ADMIN,
        description: '透過 Staging Admin 幫自己或其他 admin 帳號新增指定 brand 的 role (需有 Administrator)',
      },
      {
        name: 'Role 加 OTP/Device 解除權限',
        value: GRANT_USER_OPS_ACCESS,
        description: '幫指定 brand 的 role 加上「解除使用者 OTP 限制 / 解除綁定 device」的 access (需有 Administrator)',
      },
      {
        name: '解除使用者 OTP 限制',
        value: RESET_USER_OTP_LIMIT,
        description: '對指定 user 執行 unlockOTPLimit; 權限不足時可直接串接上面那個加權限流程再重試',
      },
      new Separator(),
      ...loginProfiles.map((item) => ({ name: `${item.displayName}`, value: item.displayName })),
    ],
    loop: false,
    pageSize: 15,
  }).catch(() => null)
  if (answer == null) return void errorConsole('使用者取消')

  if (answer === GET_WHITELABEL_INFO) return void generateBrandInfo()
  if (answer === REGISTER_BY_LIST) return void registerByList()
  if (answer === GENERATE_AND_LOGIN) return void generateAndLogin()
  if (answer === LOGIN_STAGING_ADIN) return void loginStagingAdmin()
  if (answer === CLEAR_EMAIL_CACHE) return void clearEmailCache()
  if (answer === DEPOSIT_TO_USER) return void runDepositCli()
  if (answer === ADD_ROLE_TO_ADMIN) return void runAddRoleCli()
  if (answer === GRANT_USER_OPS_ACCESS) return void runGrantUserOpsAccessCli()
  if (answer === RESET_USER_OTP_LIMIT) return void runResetUserOtpLimitCli()
  if (answer === BACKFILL_PROFILE_IDENTIFIERS) return void runBackfillProfileIdentifiersCli()
  if (answer === OPERATE_REDIS) return void operateRedis()
  if (answer === RUN_MOCK_SERVER) return void mockServerMenu()

  if (answer === OTP_PROXY_SERVER) {
    await otpProxyMenu()
    return
  }
  
  if (answer === TWO_FA_HELPER) {
    await twoFaHelper()
    return
  }

  if (answer === TWO_FA_PROFILE_HELPER) {
    await twoFaProfileHelper()
    return
  }

  if (answer === JIRA_BRANCH_HELPER) {
    await jiraBranchHelper()
    return 
  }

  if (answer === CHROME_WINDOW_HELPER) {
    await chromeWindowHelper()
    return
  }

  if (answer === RELEASE_CHECK) {
    await releaseCheckHelper()
    return
  }

  if (answer === WRITE_MR) {
    await writeActionHelper('mr')
    return
  }

  if (answer === WRITE_PIPELINE) {
    await writeActionHelper('pipeline')
    return
  }

  if (answer === WRITE_JIRA_LINK) {
    await writeActionHelper('jira')
    return
  }

  if (answer === WATCHERS) {
    await watchersHelper()
    return
  }

  if (answer === CONFIG_SERVER) {
    spawnSync(hatDevScriptPath, [], { stdio: 'inherit' })
    return
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

  loginDisposable(payload, { port }).catch((err) => {
    errorConsole('Error during login:', err?.message ?? err)
    if (err?.stack) errorConsole(err.stack)
  })
}

function colorMessage(message) {
  return blue(message)
}
