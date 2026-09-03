import select, { Separator } from '@inquirer/select'
import { input, confirm } from '@inquirer/prompts'
import { lightGreen, lightRed, lightCyan, yellow, green } from '../color.js'
import { loadSettings } from '../auto-login/settings-loader.js'
import { AdminApiError, getAssignedRoles, makeAdminRequest, stageLog, toAdminRoleWhitelabel } from './admin-api.js'
import { ensureAndSwitchToBrandRole } from './deposit.js'
import { getAdminTokenWithCache, selectAdminAccount } from './admin-token-cache.js'
import { runGrantUserOpsAccessCli } from './grant-user-ops-access.js'

// 從 reset-otp.har 觀察到的錯誤碼: 目前登入的 role 沒有 users.unlock_user_limit 這項 access
const PERMISSION_DENIED_CODE = 53522

export async function searchUsersByEmail(token, email) {
  const fd = new FormData()
  fd.append('email', email)
  fd.append('pageNum', '1')
  fd.append('pageSize', '10')

  const resp = await makeAdminRequest({
    stage: `查 user (email="${email}")`,
    method: 'POST',
    path: '/api/user/userList',
    body: fd,
    token,
  })

  const list = resp?.data?.data
  if (!Array.isArray(list)) {
    throw new AdminApiError({
      stage: `查 user (email="${email}")`,
      url: '/api/user/userList',
      method: 'POST',
      params: { email },
      status: 200,
      responseBody: resp,
      cause: new Error('response.data.data 不是陣列'),
    })
  }
  return list // [{ fid, username, femail, uid, fstatus, ... }]
}

// fuzzy 解析: 用 email 查, 剛好 1 筆就自動選; 否則列出讓使用者選或重新輸入
async function resolveTargetUser(token, initialEmail) {
  let query = initialEmail
  while (true) {
    stageLog(`查 user (email="${query}")`)
    const candidates = await searchUsersByEmail(token, query)

    if (candidates.length === 1) {
      const only = candidates[0]
      console.log(green(`  ✓ 找到 1 筆: ${only.username} (uid=${only.uid})`))
      return only
    }

    if (candidates.length === 0) {
      console.log(yellow(`  ⚠ 查 "${query}" 沒有任何 user`))
    } else {
      console.log(yellow(`  ⚠ 查 "${query}" 找到 ${candidates.length} 筆, 請選一個`))
    }

    const userChoices = candidates.slice(0, 10).map((u) => ({
      name: `${u.username}  (email=${u.femail}, uid=${u.uid})`,
      value: u,
    }))
    const choices = userChoices.length > 0
      ? [...userChoices, new Separator(), { name: '重新輸入 email', value: '__reenter__' }, { name: '取消', value: '__cancel__' }]
      : [{ name: '重新輸入 email', value: '__reenter__' }, { name: '取消', value: '__cancel__' }]

    const picked = await select({ message: '選一個 user 或重新輸入:', choices, loop: false }).catch(() => '__cancel__')

    if (picked === '__cancel__' || picked == null) return null
    if (picked === '__reenter__') {
      const newQ = await input({
        message: '輸入目標 user 的 email:',
        validate: (value) => (value.trim().length > 0 ? true : '不能空白'),
      }).then((v) => v.trim()).catch(() => null)
      if (!newQ) return null
      query = newQ
      continue
    }
    return picked
  }
}

async function callUnlockOtpLimit(token, username) {
  const fd = new FormData()
  fd.append('username', username)

  return makeAdminRequest({
    stage: `解除 OTP 限制 (user=${username})`,
    method: 'POST',
    path: '/api/user/unlockOTPLimit',
    body: fd,
    token,
  })
}

// 呼叫 unlockOTPLimit; 如果剛好是「權限不足」, 問要不要現在就去跑加權限流程, 加完後自動切回 brand role 重試一次
async function tryUnlockWithPermissionFallback({ token, adminname, brandName, username }) {
  stageLog(`解除 OTP 限制 (user=${username})`)
  try {
    await callUnlockOtpLimit(token, username)
    console.log(lightGreen(`🎉 已解除 ${username} 的 OTP 限制`))
    return
  } catch (e) {
    if (!(e instanceof AdminApiError) || e.responseBody?.code !== PERMISSION_DENIED_CODE) throw e

    console.log()
    console.log(lightRed(`✗ 目前這個 role 沒有「解除使用者 OTP 限制」的 access (${e.responseBody?.msg})`))
    const shouldGrant = await confirm({
      message: '要現在就去跑「Role 加 OTP/Device 解除權限」幫這個 role 加上這項 access 嗎?',
      default: true,
    }).catch(() => false)
    if (!shouldGrant) return console.log(yellow('已取消, 沒有解除 OTP 限制'))

    await runGrantUserOpsAccessCli()

    console.log()
    stageLog(`重新切回 "${brandName}" 的 role 並重試`)
    await ensureAndSwitchToBrandRole({ token, adminname, brandName })
    await callUnlockOtpLimit(token, username)
    console.log(lightGreen(`🎉 已解除 ${username} 的 OTP 限制`))
  }
}

// brandName/email 可由呼叫端帶入 (例如 2fa-profile-helper.js 登入卡在 OTP 上限時直接帶入當前 profile 的資訊),
// 帶了就跳過對應的選單/輸入, 沒帶則跟原來一樣互動詢問
export async function runResetUserOtpLimitCli({ brandName: presetBrandName, email: presetEmail } = {}) {
  const settings = loadSettings()
  const brandList = settings['brand-list'] ?? {}
  const brandNames = Object.keys(brandList).sort()
  if (brandNames.length === 0) {
    console.log(lightRed('settings.json 的 brand-list 是空的'))
    return
  }

  let brandName = presetBrandName ?? null
  if (brandName != null) {
    console.log(lightCyan(`brand: ${brandName} (沿用呼叫端帶入的值)`))
  } else {
    brandName = await select({
      message: '要解除哪個 brand 的 user OTP 限制?',
      choices: brandNames.map((n) => ({ name: n, value: n })),
      loop: false,
    }).catch(() => null)
    if (brandName == null) return console.log(yellow('使用者取消'))
  }

  let initialEmail = presetEmail ?? null
  if (initialEmail != null) {
    console.log(lightCyan(`email: ${initialEmail} (沿用呼叫端帶入的值)`))
  } else {
    initialEmail = await input({
      message: '輸入目標 user 的 email:',
      validate: (value) => (value.trim().length > 0 ? true : '不能空白'),
    }).then((v) => v.trim()).catch(() => null)
    if (!initialEmail) return console.log(yellow('使用者取消'))
  }

  const adminEntry = await selectAdminAccount()
  if (!adminEntry) return console.log(yellow('使用者取消'))

  let token
  try {
    ;({ token } = await getAdminTokenWithCache(adminEntry))
  } catch (e) {
    return console.log(lightRed(`登入失敗: ${e?.message ?? e}`))
  }

  const adminname = adminEntry.account
  console.log(lightCyan(`👤 當前 admin: ${adminname}`))

  try {
    // 1) 先檢查 role, 沒有的話 prompt 是否要自動加 (跟 deposit.js 的慣例一致)
    const assigned = await getAssignedRoles(token)
    const hasBrandRole = assigned.some((r) => r.platform === toAdminRoleWhitelabel(brandName))
    let allowAutoAddRole = false
    if (!hasBrandRole) {
      console.log(yellow(`⚠ 當前 admin (${adminname}) 沒有 brand "${brandName}" 的 role`))
      allowAutoAddRole = await confirm({
        message: `要自動幫你新增 ${brandName} 的 role 嗎? (寫權限動作, 會持續存在)`,
        default: false,
      }).catch(() => false)
      if (!allowAutoAddRole) return console.log(yellow('使用者選擇不新增, 中止'))
    }

    // 2) 切到 brand role (在搜尋 user 之前, 才會用對的 role 搜尋)
    await ensureAndSwitchToBrandRole({ token, adminname, brandName, allowAutoAddRole })

    // 3) 切完 role 才做 fuzzy 解析
    const targetUser = await resolveTargetUser(token, initialEmail)
    if (!targetUser) return console.log(yellow('未選定 user, 取消'))

    const isConfirm = await confirm({
      message: `確定要解除 ${targetUser.username} (email=${targetUser.femail}) 的 OTP 限制嗎?`,
      default: false,
    }).catch(() => false)
    if (!isConfirm) return console.log(yellow('已取消'))

    await tryUnlockWithPermissionFallback({ token, adminname, brandName, username: targetUser.username })
  } catch (e) {
    if (e instanceof AdminApiError) e.print()
    else console.log(lightRed(`✗ 流程錯誤: ${e?.message ?? e}`))
  }
}
