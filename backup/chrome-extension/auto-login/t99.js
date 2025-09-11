import { loadSettings } from './settings-loader.js'
import { LoginNeeded } from './login-stuff.js'
import { errorConsole, loginDisposable, warnConsole } from './t99-utils.js'
import select, { Separator } from '@inquirer/select'
import { input, confirm } from '@inquirer/prompts'
import { generateBrandInfo } from './generate-brand-info.js'
import { parseArgs } from './args-parser.js'

function colorMessage(message) {
  return `\x1b[34m${message}\x1b[0m`
}
function redMessage(message) {
  return `\x1b[31m${message}\x1b[0m`
}

const GET_WHITELABEL_INFO = 'GET_WHITELABEL_INFO'
const supportedCmdArgs = ['port', 'profile']

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
  const profileMap = Object.fromEntries(loginProfiles.map((item) => [item.displayName, item.value]))

  if (loginProfiles.length === 0) {
    warnConsole('👽警告👽 settings.json 裡的 loginProfiles 為空\n')
  }

  // 檢查是否從命令列提供了 profile 參數
  let profileKey = null
  if (cmdArgs.profile != null) {
    if (profileMap[cmdArgs.profile] == null) {
      warnConsole('透過 cmd 傳入的 profile 參數沒有匹配到 settings.json 裡的 profile 清單')
    } else {
      profileKey = cmdArgs.profile
    }
  }

  if (profileKey == null) {
    const answer = await select({
      message: '你要做什麼? ',
      choices: [
        {
          name: '重新生成 WL 的資訊',
          value: GET_WHITELABEL_INFO,
          description: '從 frontend repo 取得 WL 的 api path 等資訊',
        },
        new Separator(),
        ...loginProfiles.map((item) => ({ name: `${item.displayName}`, value: item.displayName })),
      ],
      loop: false,
    }).catch(() => null)
    if (answer == null) return void console.log(redMessage('使用者取消'))

    if (answer === GET_WHITELABEL_INFO) {
      generateBrandInfo()
      return
    }

    profileKey = answer
  }

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
        const result = /^\d+$/.test(value)
        return result || '請輸入正確的 port 號'
      },
    }).catch(() => ({ error: '使用者取消' }))
    if (portInput?.error != null) return void console.log(redMessage(portInput?.error))
    port = portInput
  }

  console.log()
  console.log(colorMessage('選擇的 profile: '), profileKey)
  console.log(colorMessage('是否是開啟 localhost: '), !!port)
  !!port && console.log(colorMessage('localhost 的 port 號: '), port)
  console.log()

  const go = await confirm({ message: '開始登入囉?' }).catch(() => null)
  if (!go) return void console.log(redMessage('使用者取消'))
  console.log()

  const payload = profileMap[profileKey]
  if (payload == null) return console.error('Setting not found:', profileKey)

  loginDisposable(payload, { port }).catch((err) => {
    console.error('Error during login:', err)
  })
}

start()
