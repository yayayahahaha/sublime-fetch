import select, { Separator } from '@inquirer/select'
import { input, confirm } from '@inquirer/prompts'
import { lightGreen, lightRed, lightCyan, yellow, green, blue } from '../color.js'
import { loadSettings } from '../auto-login/settings-loader.js'
import { gen2FaCode, get2FaTimeRemaining } from '../auto-login/2fa.js'
import {
  AdminApiError,
  getAssignedRoles,
  makeAdminRequest,
  pickRoleByPriority,
  stageLog,
  switchRole,
} from './admin-api.js'
import { addRoleToAccount } from './add-role.js'
import { getAdminTokenWithCache, getLastApproveOtp, saveLastApproveOtp, selectAdminAccount } from './admin-token-cache.js'

const CURRENCY = 'USDT'
const APPROVE_OPERATION = 3
const CATEGORY_DEPOSIT = 1 // /api/apiGateway/payment/admin/v1/adjustment/categories: 1 = "Deposit"

async function searchUserByUsername(token, username) {
  const resp = await makeAdminRequest({
    stage: `查 user "${username}"`,
    method: 'GET',
    path: '/api/v2/finance/batchAdjustment/users',
    query: { username },
    token,
  })
  const list = resp?.data ?? []
  if (!Array.isArray(list)) {
    throw new AdminApiError({
      stage: `查 user "${username}"`,
      url: '/api/v2/finance/batchAdjustment/users',
      method: 'GET',
      params: { username },
      status: 200,
      responseBody: resp,
      cause: new Error('response.data 不是陣列'),
    })
  }
  return list
}

async function submitAdjustment(token, { username, amount, remarks, memo }) {
  const fd = new FormData()
  fd.append('currency', CURRENCY)
  fd.append('category', String(CATEGORY_DEPOSIT))
  fd.append('cashChangeDate', '')
  fd.append('bankRef', '')
  fd.append('remarks', remarks)
  fd.append('memo', memo)
  fd.append('handlingFee', '0')
  fd.append('username', username)
  fd.append('transactionType', 'deposit')
  fd.append('clientAmount', String(amount))
  fd.append('receivedAmount', String(amount))
  fd.append('amount', String(amount))
  fd.append('needTransferToCross', 'false')

  return makeAdminRequest({
    stage: `送出 deposit 申請 (user=${username}, amount=${amount})`,
    method: 'POST',
    path: '/api/finance/adjustment',
    body: fd,
    token,
  })
}

async function findPendingApprovalRef(token, { username, amount }) {
  const fd = new FormData()
  fd.append('username', username)
  fd.append('uid', '')
  fd.append('requestor', '')
  fd.append('benefitCode', '')
  fd.append('batchId', '')
  fd.append('type', '')
  fd.append('currency', '')
  fd.append('status', '')
  fd.append('orderField', '')
  fd.append('orderDirection', '')
  fd.append('dateFrom', '')
  fd.append('dateTo', '')
  fd.append('updateDateFrom', '')
  fd.append('updateDateTo', '')
  fd.append('currentPage', '1')
  fd.append('pageSize', '10')

  const resp = await makeAdminRequest({
    stage: `查 pending approval (user=${username})`,
    method: 'POST',
    path: '/api/finance/pendingApproval',
    body: fd,
    token,
  })

  const rows = resp?.data?.data ?? []
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new AdminApiError({
      stage: `查 pending approval (user=${username})`,
      url: '/api/finance/pendingApproval',
      method: 'POST',
      params: { username, currentPage: 1, pageSize: 10 },
      status: 200,
      responseBody: resp,
      cause: new Error('pendingApproval 列表為空, 找不到剛建立的申請'),
    })
  }

  const found = rows.find(
    (r) =>
      r.username === username &&
      Number(r.amount) === Number(amount) &&
      r.currency === CURRENCY &&
      r.transactionType === 1, // deposit
  )
  if (!found) {
    throw new AdminApiError({
      stage: `查 pending approval (user=${username})`,
      url: '/api/finance/pendingApproval',
      method: 'POST',
      params: { username, amount, expectedTransactionType: 1, expectedCurrency: CURRENCY },
      status: 200,
      responseBody: { firstRow: rows[0] },
      cause: new Error('前 10 筆 pendingApproval 都對不上剛送的 (username, amount, currency, deposit)'),
    })
  }
  return found
}

async function approveTransaction(token, { otpCode, benefitCodes, clientamt, remarks }) {
  const fd = new FormData()
  fd.append('otpCode', otpCode)
  fd.append('benefitCodes', benefitCodes)
  fd.append('operation', String(APPROVE_OPERATION))
  fd.append('clientamt', String(clientamt))
  fd.append('remarks', remarks)

  return makeAdminRequest({
    stage: `approve transaction (ref=${benefitCodes})`,
    method: 'POST',
    path: '/api/finance/approvalTransaction',
    body: fd,
    token,
  })
}

function formatTimestamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

function buildRemarks(adminname) {
  return `${formatTimestamp()} - auto-deposit by ${adminname}`
}

// 共用: 確保當前 admin 有 brand 的 role, 並切換到該 role (含優先順序 _root > _admin > 其他)
// allowAutoAddRole=true 時, 沒 role 會自動透過 addRoleToAccount 補上
export async function ensureAndSwitchToBrandRole({ token, adminname, brandName, allowAutoAddRole = false }) {
  stageLog(`確認 ${brandName} 的 role`)
  let assigned = await getAssignedRoles(token)
  let brandRoles = assigned.filter((r) => r.platform === brandName)

  if (brandRoles.length === 0) {
    if (!allowAutoAddRole) {
      throw new Error(`當前 admin 沒有 brand "${brandName}" 的 role, 使用者選擇不自動新增, 中止`)
    }
    console.log(yellow(`  ⚠ 沒有 ${brandName} 的 role, 自動新增中...`))
    await addRoleToAccount({ token, adminname, brandName })
    assigned = await getAssignedRoles(token)
    brandRoles = assigned.filter((r) => r.platform === brandName)
    if (brandRoles.length === 0) {
      throw new Error(`新增完 role 後仍找不到 ${brandName} 的 role, 中止`)
    }
  }

  const targetRole = pickRoleByPriority(brandRoles)
  stageLog(`切到 ${targetRole.roleName} (id=${targetRole.id})`)
  await switchRole(token, targetRole.id)
  return targetRole
}

// 主流程, 可以單獨被呼叫
export async function depositToUser({ token, adminname, secretCode2Fa, brandName, username, amount, allowAutoAddRole = false, skipOtpWindowWait = false, skipRoleSetup = false }) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`amount 必須是大於 0 的數字, 收到: ${amount}`)
  }

  // (A) 確保有 brand 的 role (caller 已處理就跳過)
  if (!skipRoleSetup) {
    await ensureAndSwitchToBrandRole({ token, adminname, brandName, allowAutoAddRole })
  }

  // (B) 找 user
  stageLog(`查 user "${username}"`)
  const candidates = await searchUserByUsername(token, username)
  const exact = candidates.find((u) => u.username === username)
  if (!exact) {
    const sample = candidates.slice(0, 5).map((u) => u.username).join(', ')
    throw new Error(
      `找不到 username === "${username}" 的 user (回了 ${candidates.length} 筆 partial match${sample ? `: ${sample}` : ''})`,
    )
  }
  console.log(green(`  ✓ 找到 user: uid=${exact.uid}`))

  // (C) 送 deposit
  const remarks = buildRemarks(adminname)
  const memo = remarks
  stageLog(`送出 deposit (${amount} ${CURRENCY})`)
  console.log(blue(`  remarks/memo: ${remarks}`))
  await submitAdjustment(token, { username, amount, remarks, memo })
  console.log(green(`  ✓ 申請送出`))

  // (D) 找 ref
  stageLog(`抓回剛建立的 transactionRef`)
  const pending = await findPendingApprovalRef(token, { username, amount })
  const transactionRef = pending.transactionRef
  console.log(green(`  ✓ ref=${transactionRef}`))

  // (E) approve (OTP 在這裡 last-minute 生)
  // 會等下一個 window 的情境:
  //   1) skipOtpWindowWait=false (cache miss 全新登入, login 消耗了 OTP)
  //   2) 當下 window 剩餘秒數太少, request 飛過去就跨 window
  //   3) 跟上次 approve 用的 OTP 一樣 (連續 deposit 撞到同 window, backend replay 防護會拒收)
  const MIN_WINDOW_REMAINING = 3
  const otpCode = await (async () => {
    const previousOtp = getLastApproveOtp(adminname)
    let candidate = gen2FaCode(secretCode2Fa, { verbose: false })
    const remainingNow = get2FaTimeRemaining()

    const reasons = []
    if (!skipOtpWindowWait) reasons.push('cache miss → 避免跟 login OTP 撞 replay-protection')
    if (remainingNow < MIN_WINDOW_REMAINING) reasons.push(`window 只剩 ${remainingNow}s, 怕送過去就過期`)
    if (previousOtp && previousOtp === candidate) reasons.push(`跟上次 approve 用的 OTP (${previousOtp}) 一樣, 會被 replay 防護拒收`)

    if (reasons.length === 0) {
      stageLog(`產生 2FA OTP 並 approve (window 剩 ${remainingNow}s, 不用等)`)
      return candidate
    }

    stageLog(`等到下一個 TOTP window 再產生 approve OTP`)
    reasons.forEach((r) => console.log(blue(`  · ${r}`)))
    const waitSec = remainingNow + 1
    console.log(blue(`  目前 window 剩 ${remainingNow}s, 等 ${waitSec}s...`))
    await new Promise((r) => setTimeout(r, waitSec * 1000))
    return gen2FaCode(secretCode2Fa, { verbose: false })
  })()
  console.log(blue(`  OTP=${otpCode} (window 剩 ${get2FaTimeRemaining()}s)`))
  saveLastApproveOtp(adminname, otpCode)
  await approveTransaction(token, {
    otpCode,
    benefitCodes: transactionRef,
    clientamt: amount,
    remarks,
  })

  console.log(lightGreen(`🎉 Deposit 完成: ${amount} ${CURRENCY} → ${username} (ref=${transactionRef})`))
  return { username, uid: exact.uid, amount, currency: CURRENCY, transactionRef }
}

// fuzzy 解析: 先嘗試 exact match; 沒中就列出前 10 筆 partial 讓使用者選, 或重新輸入。
async function resolveUsername(token, initialQuery) {
  let query = initialQuery
  while (true) {
    stageLog(`查 user "${query}"`)
    const candidates = await searchUserByUsername(token, query)
    const exact = candidates.find((u) => u.username === query)
    if (exact) {
      console.log(green(`  ✓ 找到 exact match: ${exact.username} (uid=${exact.uid})`))
      return exact
    }

    if (candidates.length === 0) {
      console.log(yellow(`  ⚠ 查 "${query}" 沒有任何 user`))
    } else {
      console.log(yellow(`  ⚠ 沒有 exact match "${query}", 但有 ${candidates.length} 筆 partial match (列出前 10)`))
    }

    const userChoices = candidates.slice(0, 10).map((u) => ({
      name: `${u.username}  (uid=${u.uid})`,
      value: u,
    }))
    const choices = userChoices.length > 0
      ? [...userChoices, new Separator(), { name: '重新輸入 username', value: '__reenter__' }, { name: '取消', value: '__cancel__' }]
      : [{ name: '重新輸入 username', value: '__reenter__' }, { name: '取消', value: '__cancel__' }]

    const picked = await select({
      message: '選一個 user 或重新輸入:',
      choices,
      loop: false,
    }).catch(() => '__cancel__')

    if (picked === '__cancel__' || picked == null) return null
    if (picked === '__reenter__') {
      const newQ = await input({
        message: '輸入 username:',
        validate: (value) => (value.trim().length > 0 ? true : '不能空白'),
      }).then((v) => v.trim()).catch(() => null)
      if (!newQ) return null
      query = newQ
      continue
    }
    return picked
  }
}

export async function runDepositCli() {
  const settings = loadSettings()
  const brandList = settings['brand-list'] ?? {}
  const brandNames = Object.keys(brandList).sort()
  if (brandNames.length === 0) return console.log(lightRed('settings.json 的 brand-list 是空的'))

  const brandName = await select({
    message: '要 deposit 到哪個 brand 的 user?',
    choices: brandNames.map((n) => ({ name: n, value: n })),
    loop: false,
  }).catch(() => null)
  if (brandName == null) return console.log(yellow('使用者取消'))

  const initialUsername = await input({
    message: '輸入 user 的 username (可以模糊, 之後會讓你選):',
    validate: (value) => (value.trim().length > 0 ? true : '不能空白'),
  }).then((v) => v.trim()).catch(() => null)
  if (!initialUsername) return console.log(yellow('使用者取消'))

  const amount = await input({
    message: `輸入 deposit 金額 (${CURRENCY}):`,
    validate: (value) => {
      const n = Number(value.trim())
      if (!Number.isFinite(n)) return '請輸入數字'
      if (n <= 0) return '金額必須大於 0'
      return true
    },
  }).then((v) => Number(v.trim())).catch(() => null)
  if (amount == null) return console.log(yellow('使用者取消'))

  const adminEntry = await selectAdminAccount()
  if (!adminEntry) return console.log(yellow('使用者取消'))

  let token
  let usedCache
  try {
    ;({ token, usedCache } = await getAdminTokenWithCache(adminEntry))
  } catch (e) {
    return console.log(lightRed(`登入失敗: ${e?.message ?? e}`))
  }

  const adminname = adminEntry.account
  console.log(lightCyan(`👤 當前 admin: ${adminname}`))

  try {
    // 1) 先檢查 role, 沒有的話 prompt 是否要自動加
    const assigned = await getAssignedRoles(token)
    const hasBrandRole = assigned.some((r) => r.platform === brandName)
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
    const resolvedUser = await resolveUsername(token, initialUsername)
    if (!resolvedUser) return console.log(yellow('未選定 user, 取消'))

    await depositToUser({
      token,
      adminname,
      secretCode2Fa: adminEntry.secretCode2Fa,
      brandName,
      username: resolvedUser.username,
      amount,
      allowAutoAddRole,
      skipOtpWindowWait: usedCache, // cache 命中 → 沒消耗 login OTP, 不用等
      skipRoleSetup: true,           // 上面已經切過
    })
  } catch (e) {
    if (e instanceof AdminApiError) e.print()
    else console.log(lightRed(`✗ 流程錯誤: ${e?.message ?? e}`))
  }
}
