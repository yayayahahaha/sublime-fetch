import select, { Separator } from '@inquirer/select'
import { input } from '@inquirer/prompts'
import { lightGreen, lightRed, lightCyan, yellow, green } from '../color.js'
import { loadSettings } from '../auto-login/settings-loader.js'
import {
  AdminApiError,
  getAssignedRoles,
  makeAdminRequest,
  pickRoleByPriority,
  stageLog,
  switchRole,
} from './admin-api.js'
import { getAdminTokenWithCache, selectAdminAccount } from './admin-token-cache.js'

const ADMINISTRATOR_ROLE_ID = 1
const ADMINISTRATOR_ROLE_NAME = 'Administrator'

async function roleListForAdminInfo(token, adminName) {
  const fd = new FormData()
  fd.append('adminName', adminName)

  const resp = await makeAdminRequest({
    stage: '取得可指派的 role 清單',
    method: 'POST',
    path: '/api/admin/roleListForAdminInfo',
    body: fd,
    token,
  })

  const list = resp?.data?.data
  if (!Array.isArray(list)) {
    throw new AdminApiError({
      stage: '取得可指派的 role 清單',
      url: '/api/admin/roleListForAdminInfo',
      method: 'POST',
      params: { adminName },
      status: 200,
      responseBody: resp,
      cause: new Error('response.data.data 不是陣列'),
    })
  }
  return list
}

// 查任意帳號目前的 role (不需要對方 token, 靠自己 Administrator 權限查)
async function getAdminProfileRoles(token, adminName) {
  const fd = new FormData()
  fd.append('adminName', adminName)

  const resp = await makeAdminRequest({
    stage: `查詢 ${adminName} 目前的 role`,
    method: 'POST',
    path: '/api/admin/adminProfile',
    body: fd,
    token,
  })

  const roles = resp?.data?.roles
  if (!Array.isArray(roles)) {
    throw new AdminApiError({
      stage: `查詢 ${adminName} 目前的 role`,
      url: '/api/admin/adminProfile',
      method: 'POST',
      params: { adminName },
      status: 200,
      responseBody: resp,
      cause: new Error('response.data.roles 不是陣列'),
    })
  }
  return roles // [{ role: roleName, whitelabel: brandName, ... }]
}

async function searchAdminByUsername(token, username) {
  const fd = new FormData()
  fd.append('username', username)
  fd.append('orderField', '')
  fd.append('orderDirection', '')
  fd.append('statusValue', '1,3')
  fd.append('roleid', '')
  fd.append('pageNum', '1')
  fd.append('pageSize', '10')

  const resp = await makeAdminRequest({
    stage: `查 admin 帳號 "${username}"`,
    method: 'POST',
    path: '/api/admin/adminList',
    body: fd,
    token,
  })

  const list = resp?.data?.data ?? []
  if (!Array.isArray(list)) {
    throw new AdminApiError({
      stage: `查 admin 帳號 "${username}"`,
      url: '/api/admin/adminList',
      method: 'POST',
      params: { username },
      status: 200,
      responseBody: resp,
      cause: new Error('response.data.data 不是陣列'),
    })
  }
  return list // [{ fname, email, fstatus, rolename, ... }]
}

// fuzzy 解析目標帳號: 剛好 1 筆才自動選用; 0 筆或 2 筆以上都要使用者自己選 (exact match 太容易誤選到同名但不同 brand 的帳號)。回傳 null = 使用者取消。
async function resolveAdminUsername(token, initialQuery) {
  let query = initialQuery
  while (true) {
    stageLog(`查 admin 帳號 "${query}"`)
    const candidates = await searchAdminByUsername(token, query)

    if (candidates.length === 1) {
      const only = candidates[0]
      console.log(green(`  ✓ 找到 1 筆: ${only.fname} (${only.email}, role=${only.rolename ?? 'n/a'})`))
      return only
    }

    if (candidates.length === 0) {
      console.log(yellow(`  ⚠ 查 "${query}" 沒有任何 admin 帳號`))
    } else {
      console.log(yellow(`  ⚠ 查 "${query}" 找到 ${candidates.length} 筆, 請選一個 (列出前 10)`))
    }

    const adminChoices = candidates.slice(0, 10).map((a) => ({
      name: `${a.fname}  (${a.email}, role=${a.rolename ?? 'n/a'})`,
      value: a,
    }))
    const choices = adminChoices.length > 0
      ? [...adminChoices, new Separator(), { name: '重新輸入 username', value: '__reenter__' }, { name: '取消', value: '__cancel__' }]
      : [{ name: '重新輸入 username', value: '__reenter__' }, { name: '取消', value: '__cancel__' }]

    const picked = await select({
      message: '選一個 admin 帳號或重新輸入:',
      choices,
      loop: false,
    }).catch(() => '__cancel__')

    if (picked === '__cancel__' || picked == null) return null
    if (picked === '__reenter__') {
      const newQ = await input({
        message: '輸入目標帳號 username:',
        validate: (value) => (value.trim().length > 0 ? true : '不能空白'),
      }).then((v) => v.trim()).catch(() => null)
      if (!newQ) return null
      query = newQ
      continue
    }
    return picked
  }
}

async function assignRoles(token, adminName, assignRoleIds) {
  await makeAdminRequest({
    stage: `指派 role 到 ${adminName}`,
    method: 'POST',
    path: '/api/admin/assignedRoles/assignment',
    body: { username: adminName, assignRoles: assignRoleIds, dismissRoles: [] },
    token,
  })
  console.log(green(`  ✓ 已指派 roleId(s)=${assignRoleIds.join(',')} 給 ${adminName}`))
}

// 查目標帳號在 brandName 下現有的 role
// targetAdminName === adminname (自己) 時用 assignedRoles (可拿到 id); 查別人時用 adminProfile (查不到 id, 只有 role name)
async function findExistingRoleForBrand(token, { adminname, targetAdminName, brandName, selfAssigned }) {
  if (targetAdminName === adminname) {
    const existing = selfAssigned.filter((r) => r.platform === brandName)
    if (existing.length === 0) return null
    const picked = pickRoleByPriority(existing)
    return { roleName: picked.roleName, idSuffix: ` (id=${picked.id})` }
  }
  const targetRoles = await getAdminProfileRoles(token, targetAdminName)
  const existing = targetRoles.filter((r) => r.whitelabel === brandName)
  if (existing.length === 0) return null
  const picked = pickRoleByPriority(existing, { nameKey: 'role' })
  return { roleName: picked.role, idSuffix: '' }
}

// 對 brandName 已經有 role 的話, 不做任何事; 否則(用自己的 Administrator 權限)切到 Administrator 再 assign 給目標帳號
// targetAdminName 預設是自己 (adminname); 指定別的帳號時, 會改用 adminProfile API 查/驗證對方現有的 role (因為查不到別人 token 底下的 assignedRoles)
// 回傳: { added: boolean, roleName: string }
export async function addRoleToAccount({ token, adminname, brandName, targetAdminName = adminname }) {
  if (!token || !adminname || !brandName) {
    throw new Error('addRoleToAccount: token / adminname / brandName 都為必填')
  }

  stageLog(`檢查 ${targetAdminName} 在 brand "${brandName}" 是否已有 role`)
  const selfAssigned = await getAssignedRoles(token)
  const existing = await findExistingRoleForBrand(token, { adminname, targetAdminName, brandName, selfAssigned })
  if (existing) {
    console.log(green(`  ✓ ${targetAdminName} 已存在 role: ${existing.roleName}${existing.idSuffix}`))
    return { added: false, roleName: existing.roleName }
  }

  console.log(yellow(`  ⚠ ${targetAdminName} 還沒有 ${brandName} 的 role, 準備新增`))

  // 切到 Administrator 才能 assign (權限看的是登入者自己 adminname, 跟 targetAdminName 無關)
  const hasAdministrator = selfAssigned.some(
    (r) => r.id === ADMINISTRATOR_ROLE_ID || r.roleName === ADMINISTRATOR_ROLE_NAME,
  )
  if (!hasAdministrator) {
    throw new Error(
      `當前 admin (${adminname}) 沒有 Administrator role, 無法執行 role 指派。請聯絡有權限的 admin 加上 Administrator。`,
    )
  }

  stageLog(`切到 Administrator (roleId=${ADMINISTRATOR_ROLE_ID})`)
  await switchRole(token, ADMINISTRATOR_ROLE_ID)

  stageLog(`查詢可加入的 role 清單 (目標: ${targetAdminName})`)
  const available = await roleListForAdminInfo(token, targetAdminName)
  const candidates = available.filter((r) => r.whitelabel === brandName)
  if (candidates.length === 0) {
    throw new Error(
      `在「可指派 role 清單」中找不到 brand "${brandName}" 的任何 role (共 ${available.length} 筆可用 role)`,
    )
  }

  const target = pickRoleByPriority(candidates, { nameKey: 'fname' })
  console.log(lightCyan(`  → 將指派給 ${targetAdminName}: ${target.fname} (fid=${target.fid})`))

  await assignRoles(token, targetAdminName, [target.fid])

  // 再撈一次確認
  stageLog(`重新確認 ${targetAdminName} 的 role`)
  const updatedSelfAssigned = targetAdminName === adminname ? await getAssignedRoles(token) : selfAssigned
  const verified = await findExistingRoleForBrand(token, {
    adminname,
    targetAdminName,
    brandName,
    selfAssigned: updatedSelfAssigned,
  })
  if (!verified) {
    throw new Error(`指派 API 回傳成功, 但重新查詢後仍找不到 ${brandName} 的 role, 可能有 cache 延遲`)
  }
  console.log(lightGreen(`✓ 已新增 role: ${verified.roleName}`))
  return { added: true, roleName: verified.roleName }
}

export async function runAddRoleCli() {
  const settings = loadSettings()
  const brandList = settings['brand-list'] ?? {}
  const brandNames = Object.keys(brandList).sort()
  if (brandNames.length === 0) {
    console.log(lightRed('settings.json 的 brand-list 是空的'))
    return
  }

  const brandName = await select({
    message: '要新增哪個 brand 的 role?',
    choices: brandNames.map((n) => ({ name: n, value: n })),
    loop: false,
  }).catch(() => null)
  if (brandName == null) return console.log(yellow('使用者取消'))

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

  // 目標帳號要在拿到 token 之後才能問, 才能用同一個 token 去搜尋確認帳號存在
  const targetInput = await input({
    message: '目標帳號 username (空白 = 加給自己):',
    default: '',
  }).then((v) => v.trim()).catch(() => null)
  if (targetInput == null) return console.log(yellow('使用者取消'))

  let targetAdminName = adminname
  if (targetInput) {
    try {
      const resolved = await resolveAdminUsername(token, targetInput)
      if (!resolved) return console.log(yellow('未選定目標帳號, 取消'))
      targetAdminName = resolved.fname
    } catch (e) {
      if (e instanceof AdminApiError) return void e.print()
      return console.log(lightRed(`✗ 搜尋目標帳號失敗: ${e?.message ?? e}`))
    }
  }

  try {
    const { added, roleName } = await addRoleToAccount({ token, adminname, brandName, targetAdminName })
    if (added) console.log(lightGreen(`🎉 完成: ${targetAdminName} → ${roleName}`))
    else console.log(lightGreen(`👌 不用動: ${targetAdminName} 已經有 ${roleName}`))
  } catch (e) {
    if (e instanceof AdminApiError) e.print()
    else console.log(lightRed(`✗ 流程錯誤: ${e?.message ?? e}`))
  }
}
