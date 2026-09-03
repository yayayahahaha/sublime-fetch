import { makeAdminRequest, AdminApiError } from './admin-api.js'

// 依 whitelabel/keywords 查詢 role 清單 (跟 add-role.js 其他 admin list API 一樣用 FormData)
export async function listRoles(token, { keywords = '', pageSize = 50 } = {}) {
  const fd = new FormData()
  fd.append('statusValue', '')
  fd.append('keywords', keywords)
  fd.append('orderField', '')
  fd.append('orderDirection', '')
  fd.append('pageNum', '1')
  fd.append('pageSize', String(pageSize))

  const resp = await makeAdminRequest({
    stage: `查詢 role 清單 (keywords="${keywords}")`,
    method: 'POST',
    path: '/api/admin/roleList',
    body: fd,
    token,
  })

  const list = resp?.data?.data
  if (!Array.isArray(list)) {
    throw new AdminApiError({
      stage: `查詢 role 清單 (keywords="${keywords}")`,
      url: '/api/admin/roleList',
      method: 'POST',
      params: { keywords },
      status: 200,
      responseBody: resp,
      cause: new Error('response.data.data 不是陣列'),
    })
  }
  return list // [{ fid, fname, fdescription, type, whitelabel, ... }]
}

// 取得某個 role 目前的完整權限樹:
// { categoryName: { parentId, title, security: [{ fid, fname, fparentid, enable, permission }] } }
export async function getRolePermissionTree(token, roleId) {
  const fd = new FormData()
  fd.append('roleid', roleId)

  const resp = await makeAdminRequest({
    stage: `取得 roleId=${roleId} 的權限清單`,
    method: 'POST',
    path: '/api/admin/getPermission',
    body: fd,
    token,
  })

  const tree = resp?.data
  if (tree == null || typeof tree !== 'object') {
    throw new AdminApiError({
      stage: `取得 roleId=${roleId} 的權限清單`,
      url: '/api/admin/getPermission',
      method: 'POST',
      params: { roleid: roleId },
      status: 200,
      responseBody: resp,
      cause: new Error('response.data 不是物件'),
    })
  }
  return tree
}

// 在權限樹裡找某個 fname 對應的權限項目, 回傳的是樹裡物件的參照
// (直接改它的 .permission, 之後 buildModifyRoleMenu 就會讀到新值)
export function findPermissionItem(tree, fname) {
  for (const category of Object.values(tree)) {
    const item = (category.security ?? []).find((it) => it.fname === fname)
    if (item) return item
  }
  return null
}

// 把權限樹還原成 modifyRole 要送的 menu 格式。
// 規則是從實際的 HAR (getPermission 回傳 vs modifyRole 送出) 反推出來的:
// 只送「至少有一個 enable=true 的 leaf」的分類, 該分類會多帶一個結構性項目
// { fid: category.parentId, permission: 0 }, 後面接上所有 enable=true 的 leaf 項目 (帶各自的 permission)
export function buildModifyRoleMenu(tree) {
  const menu = []
  for (const category of Object.values(tree)) {
    const enabledLeaves = (category.security ?? []).filter((item) => item.enable === true)
    if (enabledLeaves.length === 0) continue
    menu.push({ fid: category.parentId, permission: 0 })
    for (const leaf of enabledLeaves) menu.push({ fid: leaf.fid, permission: leaf.permission })
  }
  return menu
}

export async function modifyRolePermissions(token, { roleId, fname, fdescription, type, menu }) {
  return makeAdminRequest({
    stage: `更新 roleId=${roleId} (${fname}) 的權限`,
    method: 'POST',
    path: '/api/admin/modifyRole',
    body: { roleId, fname, fdescription, type, menu },
    token,
  })
}
