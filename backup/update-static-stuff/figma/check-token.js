import { consoleGreen, consoleRed, high, requireParams } from '../utils.js'
import { consoleFigmaTokenSetupHint, fetchCurrentUser } from './rest.js'

/**
 * Figma token 的 preflight 檢查: 打最輕量的 `/v1/me`, 只確認 token 本身有效 (帳號存在、沒過期/被撤銷),
 * 不驗證對特定檔案的權限 (那個要實際打開檔案才知道, 抓圖時的錯誤訊息會另外提示)。
 *
 * 檢查失敗時 (token 沒給 / 401 / 403 / 429 / 網路錯誤等) 會印出「去哪裡拿 token / 放到哪個檔案」的提示,
 * 跟 `setting.json` 沒填 `figma-token` 時的提示是同一份 (`consoleFigmaTokenSetupHint`)。
 *
 * @param {object} options
 * @param {string} options.figmaToken
 * @returns {Promise<{ok: boolean, reason: string|null, user: object|null}>}
 */
export async function checkFigmaToken({ figmaToken } = {}) {
  if (!requireParams({ figmaToken }, ['figmaToken'])) {
    console.log()
    consoleFigmaTokenSetupHint()
    return { ok: false, reason: '缺少 figmaToken', user: null }
  }

  console.log('檢查 figma-token 是否可用 (呼叫 Figma API GET /v1/me)...')
  try {
    const user = await fetchCurrentUser(figmaToken)
    consoleGreen(`✅ token 有效, 對應帳號: ${high(user.email ?? user.handle ?? user.id ?? '未知')}`)
    return { ok: true, reason: null, user }
  } catch (e) {
    consoleRed(`❌ token 檢查失敗: ${e.message}`)
    console.log()
    consoleFigmaTokenSetupHint()
    return { ok: false, reason: e.message, user: null }
  }
}
