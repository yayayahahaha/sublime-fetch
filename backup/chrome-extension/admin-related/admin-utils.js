import { loginStagingAdmin } from '../auto-login/login-staging-admin.js'
import { lightGreen, lightRed, red, yellow } from '../color.js'
import { AdminApiError, getAssignedRoles, pickRoleByPriority, stageLog, switchRole } from './admin-api.js'

// TODO(flyc) 要改得正規化一些, 像是錯誤訊息的顏色和回傳格式等等
export async function clearEmailCache() {
  let getTokenError = false
  const token = await loginStagingAdmin({ getTokenOnly: true }).catch((res) => {
    getTokenError = true

    console.log(lightRed('取得登入 token 失敗了'))
    console.log(red(res))
    return null
  })

  if (token == null) {
    if (getTokenError) return
    console.log(yellow('取得 token 成功，但要用來清除 cache 的 token 是 null'))
    return null
  }

  // 切到 btse root 的 role, 避免 cached token 停留在沒權限的 role 上
  try {
    stageLog('切換到 btse root role')
    const assigned = await getAssignedRoles(token)
    const brandRoles = assigned.filter((r) => r.platform === 'btse')
    if (brandRoles.length === 0) {
      console.log(lightRed('當前 admin 沒有 btse 的 role, 無法繼續清 cache'))
      return null
    }
    const targetRole = pickRoleByPriority(brandRoles)
    await switchRole(token, targetRole.id)
  } catch (e) {
    if (e instanceof AdminApiError) e.print()
    else console.log(lightRed(`切 role 失敗: ${e?.message ?? e}`))
    return null
  }

  return reloadEmailTemplateCacheApi(token)
    .then((res) => {
      if (!res.ok) throw res
      return res.text()
    })
    .then((res) => {
      let data = null
      try {
        data = JSON.parse(res)
      } catch {
        console.log(red('email cache data JSON parse 失敗!'))
      }

      if (data.msg !== 'Success') throw data
      console.log(lightGreen('清除 Email Cache 成功!'))
      console.log(data)
    })
    .catch((error) => {
      console.log(lightRed('清除 Email Cache 失敗!'))
      console.log(red(error))
      return false
    })
}

function reloadEmailTemplateCacheApi(token) {
  const url = 'https://admin-api.btse.co/api/system/resetMailTemplate'

  return fetch(url, {
    method: 'POST',
    headers: _genHeader(token),
    body: _genBody(),
  })

  function _genBody() {
    const formData = new FormData()
    formData.append('whitelabel', '')
    formData.append('platform', '')
    return formData
  }

  function _genHeader(token) {
    return { 'admin-token': token }
  }
}
