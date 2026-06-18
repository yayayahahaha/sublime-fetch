import select from '@inquirer/select'
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

// 對 platform 已經有 role 的話, 不做任何事; 否則切到 Administrator 再 assign
// 回傳: { added: boolean, role: <在當前 brand 下挑出的 role(以 priority)> }
export async function addRoleToSelf({ token, adminname, brandName }) {
  if (!token || !adminname || !brandName) {
    throw new Error('addRoleToSelf: token / adminname / brandName 都為必填')
  }

  stageLog(`檢查 ${adminname} 在 brand "${brandName}" 是否已有 role`)
  let assigned = await getAssignedRoles(token)
  const existing = assigned.filter((r) => r.platform === brandName)
  if (existing.length > 0) {
    const picked = pickRoleByPriority(existing)
    console.log(green(`  ✓ 已存在 role: ${picked.roleName} (id=${picked.id})`))
    return { added: false, role: picked }
  }

  console.log(yellow(`  ⚠ 還沒有 ${brandName} 的 role, 準備新增`))

  // 切到 Administrator 才能 assign
  const hasAdministrator = assigned.some(
    (r) => r.id === ADMINISTRATOR_ROLE_ID || r.roleName === ADMINISTRATOR_ROLE_NAME,
  )
  if (!hasAdministrator) {
    throw new Error(
      `當前 admin (${adminname}) 沒有 Administrator role, 無法執行 role 指派。請聯絡有權限的 admin 加上 Administrator。`,
    )
  }

  stageLog(`切到 Administrator (roleId=${ADMINISTRATOR_ROLE_ID})`)
  await switchRole(token, ADMINISTRATOR_ROLE_ID)

  stageLog(`查詢可加入的 role 清單`)
  const available = await roleListForAdminInfo(token, adminname)
  const candidates = available.filter((r) => r.whitelabel === brandName)
  if (candidates.length === 0) {
    throw new Error(
      `在「可指派 role 清單」中找不到 brand "${brandName}" 的任何 role (共 ${available.length} 筆可用 role)`,
    )
  }

  const target = pickRoleByPriority(candidates, { nameKey: 'fname' })
  console.log(lightCyan(`  → 將指派: ${target.fname} (fid=${target.fid})`))

  await assignRoles(token, adminname, [target.fid])

  // 再撈一次確認
  stageLog(`重新取得 assigned roles 確認`)
  assigned = await getAssignedRoles(token)
  const verifyExisting = assigned.filter((r) => r.platform === brandName)
  if (verifyExisting.length === 0) {
    throw new Error(`指派 API 回傳成功, 但重新撈 assignedRoles 後仍找不到 ${brandName} 的 role, 可能有 cache 延遲`)
  }
  const picked = pickRoleByPriority(verifyExisting)
  console.log(lightGreen(`✓ 已新增 role: ${picked.roleName} (id=${picked.id})`))
  return { added: true, role: picked }
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
    message: '要為自己新增哪個 brand 的 role?',
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

  try {
    const { added, role } = await addRoleToSelf({ token, adminname, brandName })
    if (added) console.log(lightGreen(`🎉 完成: ${role.roleName}`))
    else console.log(lightGreen(`👌 不用動: 已經有 ${role.roleName}`))
  } catch (e) {
    if (e instanceof AdminApiError) e.print()
    else console.log(lightRed(`✗ 流程錯誤: ${e?.message ?? e}`))
  }
}
