import { lightRed, red, yellow, blue, green } from '../color.js'

const ADMIN_API_BASE = 'https://admin-api.btse.co'
const ADMIN_WEB_ORIGIN = 'https://admin.btse.co'

export class AdminApiError extends Error {
  constructor({ stage, url, method, params, status, responseBody, cause }) {
    const head = `[${stage}] ${method} ${url}`
    super(`${head} 失敗 (status=${status ?? 'n/a'})`)
    this.name = 'AdminApiError'
    this.stage = stage
    this.url = url
    this.method = method
    this.params = params
    this.status = status
    this.responseBody = responseBody
    this.cause = cause
  }

  print() {
    console.log()
    console.log(lightRed(`✗ ${this.stage} 失敗`))
    console.log(red(`  ${this.method} ${this.url}`))
    if (this.status != null) console.log(red(`  HTTP status: ${this.status}`))
    if (this.params !== undefined) {
      console.log(red('  request params:'))
      console.log(yellow('  ' + safeStringify(this.params)))
    }
    if (this.responseBody !== undefined) {
      console.log(red('  response body:'))
      console.log(yellow('  ' + safeStringify(this.responseBody)))
    }
    if (this.cause) {
      console.log(red('  cause:'))
      console.log(yellow('  ' + (this.cause?.message ?? String(this.cause))))
    }
    console.log()
  }
}

function safeStringify(value) {
  if (value == null) return String(value)
  if (typeof value === 'string') return value
  if (typeof FormData !== 'undefined' && value instanceof FormData) {
    const obj = {}
    const hasFile = typeof File !== 'undefined'
    for (const [k, v] of value.entries()) obj[k] = hasFile && v instanceof File ? `<File ${v.name}>` : v
    return `(FormData) ` + JSON.stringify(obj, null, 2)
  }
  if (typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams) {
    return `(URLSearchParams) ` + value.toString()
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function buildBody(body) {
  if (body == null) return { body: undefined, contentType: undefined }
  if (body instanceof FormData) return { body, contentType: undefined }
  if (body instanceof URLSearchParams) {
    return { body: body.toString(), contentType: 'application/x-www-form-urlencoded;charset=UTF-8' }
  }
  if (typeof body === 'string') return { body, contentType: 'application/json' }
  return { body: JSON.stringify(body), contentType: 'application/json' }
}

// makeAdminRequest({ stage, method, path, query, body, token })
// body 接受 FormData / URLSearchParams / object(→JSON) / string(視作 JSON)
// 任何失敗 (network error / HTTP non-2xx / msg !== Success) 都會拋 AdminApiError
export async function makeAdminRequest({ stage, method = 'GET', path, query, body, token, headers: extraHeaders }) {
  if (!stage) throw new Error('makeAdminRequest: stage 為必填 (給錯誤訊息用)')
  if (!path) throw new Error('makeAdminRequest: path 為必填')
  if (!token) throw new Error('makeAdminRequest: token 為必填')

  const url = (() => {
    const u = new URL(path, ADMIN_API_BASE)
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v != null) u.searchParams.set(k, String(v))
      }
    }
    return u.toString()
  })()

  const { body: finalBody, contentType } = buildBody(body)

  const headers = {
    accept: 'application/json, text/plain, */*',
    origin: ADMIN_WEB_ORIGIN,
    referer: `${ADMIN_WEB_ORIGIN}/`,
    'admin-token': token,
    ...(contentType ? { 'content-type': contentType } : {}),
    ...extraHeaders,
  }

  let res
  try {
    res = await fetch(url, { method, headers, body: finalBody })
  } catch (e) {
    throw new AdminApiError({ stage, url, method, params: body, status: null, responseBody: null, cause: e })
  }

  const rawText = await res.text()
  let parsed = null
  try {
    parsed = rawText.length ? JSON.parse(rawText) : null
  } catch {
    parsed = rawText
  }

  if (!res.ok) {
    throw new AdminApiError({ stage, url, method, params: body, status: res.status, responseBody: parsed })
  }

  // 約定: 後端成功一律 msg === 'Success' (從現有的 clearEmailCache 模式跟 HAR 都能驗證)
  if (parsed && typeof parsed === 'object' && parsed.msg != null && parsed.msg !== 'Success') {
    throw new AdminApiError({ stage, url, method, params: body, status: res.status, responseBody: parsed })
  }

  return parsed
}

// ─────────────────────────────────────────────────────────────
// 共用 endpoint
// ─────────────────────────────────────────────────────────────

export async function getAdminInfo(token) {
  const resp = await makeAdminRequest({
    stage: '查詢當前 admin 資訊',
    method: 'POST',
    path: '/api/admin/adminInfo',
    token,
  })
  const adminname = resp?.data?.adminname
  if (!adminname) {
    throw new AdminApiError({
      stage: '查詢當前 admin 資訊',
      url: `${ADMIN_API_BASE}/api/admin/adminInfo`,
      method: 'POST',
      params: null,
      status: 200,
      responseBody: resp,
      cause: new Error('response 內找不到 data.adminname'),
    })
  }
  return { adminname, raw: resp.data }
}

export async function getAssignedRoles(token) {
  const resp = await makeAdminRequest({
    stage: '取得 assigned roles',
    method: 'GET',
    path: '/api/admin/assignedRoles',
    token,
  })
  const roles = resp?.data
  if (!Array.isArray(roles)) {
    throw new AdminApiError({
      stage: '取得 assigned roles',
      url: `${ADMIN_API_BASE}/api/admin/assignedRoles`,
      method: 'GET',
      params: null,
      status: 200,
      responseBody: resp,
      cause: new Error('response.data 不是陣列'),
    })
  }
  return roles
}

export async function switchRole(token, roleId) {
  if (roleId == null) throw new Error('switchRole: roleId 為必填')
  await makeAdminRequest({
    stage: `切換 role (roleId=${roleId})`,
    method: 'POST',
    path: '/api/admin/assignedRoles/switch',
    body: { roleId },
    token,
  })
  console.log(green(`  ✓ 已切換到 roleId=${roleId}`))
}

// settings.json 的 brand-list key 有時候跟後台 role 系統實際用的 whitelabel/platform 名字不一樣,
// 跟 auto-login/redis.js 裡 OTP key 的 brand 對應保持一致 (目前唯一已知的: autotrader → copywise)
const BRAND_TO_ADMIN_ROLE_WHITELABEL = {
  autotrader: 'copywise',
}

export function toAdminRoleWhitelabel(brandName) {
  return BRAND_TO_ADMIN_ROLE_WHITELABEL[brandName] ?? brandName
}

// 共用的優先級: 同一個 platform 有多個 role 時, _Root > _Admin > 其他
export function pickRoleByPriority(roles, { nameKey = 'roleName' } = {}) {
  if (!roles || roles.length === 0) return null
  const score = (r) => {
    const name = r?.[nameKey] ?? ''
    if (/_root$/i.test(name)) return 3
    if (/_admin$/i.test(name)) return 2
    return 1
  }
  return [...roles].sort((a, b) => score(b) - score(a))[0]
}

// 共用的 log helper (給上層流程用)
export function stageLog(message) {
  console.log(blue(`▸ ${message}`))
}
