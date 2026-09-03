import { loadSettings } from './settings-loader.js'
import { LoginNeeded } from './login-stuff.js'
import { errorConsole, warnConsole } from './t99-utils.js'

// 讀取 settings.json 的 loginProfiles, 轉成 { displayName, value: LoginNeeded 實例 } 的清單
// 會依 loadSettings() 的行為 throw, 呼叫端需自行 try/catch
export function loadLoginProfiles() {
  const rawProfiles = loadSettings()?.loginProfiles ?? []

  const loginProfiles = rawProfiles
    .map((item, index) => {
      let displayName = item.displayName ?? `「動態生成的-display-name-${index + 0}」`

      if (item.displayName == null) {
        warnConsole(`👽警告👽 第 ${index} 個 profile 缺少 displayName, 將使用 ${displayName}\n`)
      }

      try {
        return {
          displayName,
          value: new LoginNeeded({ ...item }),
        }
      } catch (error) {
        errorConsole(`生成 profile 失敗: ${error.message}`)
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { numeric: true }))

  const profileMap = Object.fromEntries(loginProfiles.map((item) => [item.displayName, item.value]))

  return { loginProfiles, profileMap }
}
