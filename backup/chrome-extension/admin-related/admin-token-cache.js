import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import select from '@inquirer/select'
import { green, yellow, lightCyan } from '../color.js'
import { loginAdmin, settingCheck } from '../auto-login/login-staging-admin.js'
import { getAdminInfo, AdminApiError } from './admin-api.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

const CACHE_DIR = path.resolve(dirname, '../cache')
const CACHE_PATH = path.resolve(CACHE_DIR, 'admin-token-cache.json')

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true })
}

function readCache() {
  ensureCacheDir()
  if (!fs.existsSync(CACHE_PATH)) return {}
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function writeCache(data) {
  ensureCacheDir()
  fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2), 'utf8')
}

function getCachedToken(adminname) {
  return readCache()[adminname]?.token ?? null
}

function saveCachedToken(adminname, token) {
  const cache = readCache()
  cache[adminname] = { ...(cache[adminname] ?? {}), token, savedAt: Date.now() }
  writeCache(cache)
}

function clearCachedToken(adminname) {
  const cache = readCache()
  // 只清 token 相關欄位, 保留 lastApproveOtp 等其他狀態
  if (cache[adminname]) {
    delete cache[adminname].token
    delete cache[adminname].savedAt
    if (Object.keys(cache[adminname]).length === 0) delete cache[adminname]
  }
  writeCache(cache)
}

export function getLastApproveOtp(adminname) {
  return readCache()[adminname]?.lastApproveOtp ?? null
}

export function saveLastApproveOtp(adminname, otp) {
  const cache = readCache()
  cache[adminname] = { ...(cache[adminname] ?? {}), lastApproveOtp: otp, lastApproveOtpAt: Date.now() }
  writeCache(cache)
}

async function isTokenHealthy(token, expectedAdminname) {
  try {
    const { adminname } = await getAdminInfo(token)
    if (expectedAdminname && adminname !== expectedAdminname) {
      console.log(yellow(`⚠ cached token 對應的 admin (${adminname}) 跟你選的 (${expectedAdminname}) 不同`))
      return false
    }
    return true
  } catch (e) {
    if (e instanceof AdminApiError) return false
    throw e
  }
}

// 在 loginStagingAdmin 之外, 給 deposit / add-role 用的 admin 帳號選擇 prompt
export async function selectAdminAccount() {
  const { status, accountList } = settingCheck()
  if (!status) return null

  const answer = await select({
    message: '要登入哪個帳號?',
    choices: accountList.map((item) => ({
      name: item.account,
      value: item,
      description: (() => {
        const pw = item.password.replace(/.(.+)./g, (m, $1) => m.replace($1, '*'.repeat($1.length)))
        return `密碼: ${pw}`
      })(),
    })),
    loop: false,
  }).catch(() => null)

  return answer ?? null
}

// 取 admin token: 優先用 cache + health check, 失敗 fallback 到完整 login
// 回傳 { token, usedCache }: usedCache=true 代表沒做完整登入 (沒消耗 2FA OTP)
export async function getAdminTokenWithCache(adminEntry) {
  const adminname = adminEntry?.account
  if (!adminname) throw new Error('getAdminTokenWithCache: adminEntry.account 為必填')

  const cached = getCachedToken(adminname)
  if (cached) {
    console.log(lightCyan(`🔎 找到 ${adminname} 的 cached token, 跑 health check...`))
    if (await isTokenHealthy(cached, adminname)) {
      console.log(green(`✓ cached token 仍然有效, 跳過完整登入`))
      return { token: cached, usedCache: true }
    }
    console.log(yellow(`⚠ cached token 失效, 移除並進行完整登入`))
    clearCachedToken(adminname)
  }

  const token = await loginAdmin(adminEntry, { getTokenOnly: true })
  if (!token) throw new Error(`完整登入未取得 token (admin=${adminname})`)
  saveCachedToken(adminname, token)
  return { token, usedCache: false }
}
