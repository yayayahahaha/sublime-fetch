import select from '@inquirer/select'
import { confirm, checkbox } from '@inquirer/prompts'
import { lightGreen, lightRed, lightCyan, green, yellow } from '../color.js'
import { loadSettings } from '../auto-login/settings-loader.js'
import { AdminApiError, getAssignedRoles, stageLog, switchRole, toAdminRoleWhitelabel } from './admin-api.js'
import { getAdminTokenWithCache, selectAdminAccount } from './admin-token-cache.js'
import {
  listRoles,
  getRolePermissionTree,
  findPermissionItem,
  buildModifyRoleMenu,
  modifyRolePermissions,
} from './role-permission.js'

const ADMINISTRATOR_ROLE_ID = 1
const ADMINISTRATOR_ROLE_NAME = 'Administrator'
const FULL_ACCESS_LEVEL = 3

// 從 rebind-access.har (成功) / reset-otp.har (權限不足時失敗) 反推出來的兩個權限項目:
// - users.unlock_user_limit  → 對應 admin 端 POST /api/user/unlockOTPLimit (解除使用者 OTP 限制)
// - users.unbind_user_device → 解除使用者綁定 device 限制
const GRANTABLE_PERMISSIONS = [
  { fname: 'users.unlock_user_limit', label: '解除使用者 OTP 限制 (unlockOTPLimit)' },
  { fname: 'users.unbind_user_device', label: '解除使用者綁定 device 限制' },
]

export async function runGrantUserOpsAccessCli() {
  const settings = loadSettings()
  const brandList = settings['brand-list'] ?? {}
  const brandNames = Object.keys(brandList).sort()
  if (brandNames.length === 0) {
    console.log(lightRed('settings.json 的 brand-list 是空的'))
    return
  }

  const brandName = await select({
    message: '要修改哪個 brand 的 role 權限?',
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

  // 修改「別的 role」的權限需要 Administrator, 跟 add-role.js 的慣例一致
  try {
    stageLog('檢查是否有 Administrator role')
    const assigned = await getAssignedRoles(token)
    const hasAdministrator = assigned.some(
      (r) => r.id === ADMINISTRATOR_ROLE_ID || r.roleName === ADMINISTRATOR_ROLE_NAME,
    )
    if (!hasAdministrator) {
      console.log(lightRed('當前 admin 沒有 Administrator role, 無法修改其他 role 的權限'))
      return
    }

    stageLog(`切到 Administrator (roleId=${ADMINISTRATOR_ROLE_ID})`)
    await switchRole(token, ADMINISTRATOR_ROLE_ID)
  } catch (e) {
    if (e instanceof AdminApiError) return void e.print()
    return console.log(lightRed(`切換 role 失敗: ${e?.message ?? e}`))
  }

  let roles
  try {
    const roleWhitelabel = toAdminRoleWhitelabel(brandName)
    stageLog(`查詢 "${brandName}" 的 role 清單`)
    const list = await listRoles(token, { keywords: roleWhitelabel })
    roles = list.filter((r) => r.whitelabel === roleWhitelabel)
  } catch (e) {
    if (e instanceof AdminApiError) return void e.print()
    return console.log(lightRed(`查詢 role 清單失敗: ${e?.message ?? e}`))
  }

  if (roles.length === 0) {
    console.log(lightRed(`在 "${brandName}" 底下找不到任何 role`))
    return
  }

  const role = await select({
    message: '要幫哪個 role 加 access?',
    choices: roles.map((r) => ({ name: `${r.fname} (roleId=${r.fid}, type=${r.type})`, value: r })),
    loop: false,
  }).catch(() => null)
  if (role == null) return console.log(yellow('使用者取消'))

  const selectedFnames = await checkbox({
    message: '要新增哪些 access?',
    choices: GRANTABLE_PERMISSIONS.map((p) => ({ name: p.label, value: p.fname, checked: true })),
  }).catch(() => null)
  if (!selectedFnames || selectedFnames.length === 0) return console.log(yellow('沒有選擇任何項目, 取消'))

  try {
    stageLog(`查詢 roleId=${role.fid} (${role.fname}) 目前的權限`)
    const tree = await getRolePermissionTree(token, role.fid)

    const plan = selectedFnames.map((fname) => {
      const label = GRANTABLE_PERMISSIONS.find((p) => p.fname === fname)?.label ?? fname
      const item = findPermissionItem(tree, fname)
      if (item == null) return { fname, label, status: 'NOT_FOUND' }
      if (item.enable && item.permission >= FULL_ACCESS_LEVEL) {
        return { fname, label, status: 'ALREADY_OK', item }
      }
      // enable=false 一樣可以改: 從 root-permission.har 反推出來的, modifyRole 送出的 menu 裡只要有
      // 這個 fid, 這個角色就會多這項 access, 跟它原本 enable 是 true 還是 false 無關
      return {
        fname,
        label,
        status: 'WILL_CHANGE',
        item,
        beforeEnable: item.enable,
        before: item.permission,
        after: FULL_ACCESS_LEVEL,
      }
    })

    console.log()
    for (const p of plan) {
      if (p.status === 'NOT_FOUND') {
        console.log(lightRed(`✗ ${p.label} (${p.fname}): 這個 role 的權限清單裡找不到這一項`))
      } else if (p.status === 'ALREADY_OK') {
        console.log(green(`👌 ${p.label}: 已經是 permission=${p.item.permission}, 不用改`))
      } else {
        const enableNote = p.beforeEnable ? '' : ' (原本是 disabled, 一併開啟)'
        console.log(lightCyan(`→ ${p.label}: permission ${p.before} → ${p.after}${enableNote}`))
      }
    }

    const toChange = plan.filter((p) => p.status === 'WILL_CHANGE')
    if (toChange.length === 0) {
      console.log()
      console.log(yellow('沒有任何權限需要變更, 沒有呼叫 modifyRole'))
      return
    }

    console.log()
    const isConfirm = await confirm({
      message: `確定要更新 roleId=${role.fid} (${role.fname}) 的權限嗎? (會送出這個 role 完整的權限清單, 只有上面列的項目會被改掉)`,
      default: false,
    }).catch(() => false)
    if (!isConfirm) return console.log(yellow('已取消'))

    for (const p of toChange) {
      p.item.permission = p.after
      p.item.enable = true
    }
    const menu = buildModifyRoleMenu(tree)

    await modifyRolePermissions(token, {
      roleId: role.fid,
      fname: role.fname,
      fdescription: role.fdescription,
      type: role.type,
      menu,
    })

    console.log()
    console.log(lightGreen(`🎉 已更新 roleId=${role.fid} (${role.fname}) 的權限`))
  } catch (e) {
    if (e instanceof AdminApiError) e.print()
    else console.log(lightRed(`✗ 流程錯誤: ${e?.message ?? e}`))
  }
}
