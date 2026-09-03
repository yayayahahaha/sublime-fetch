// QA 提供的內部 OTP 查詢服務。endpoint / body 格式是他們定的，我們自己包一層 proxy 統一格式（見 server.js）。
const QA_OTP_URL = 'http://10.1.35.77:5000/api/message/email/get_otp'
const TIMEOUT_MS = 8000

// 尚未拿到一次真實成功回應確認欄位名稱，先容錯嘗試幾個常見 key。
// 如果之後發現實際 key 不在這裡，補進這個清單即可，其他地方不用動。
const OTP_VALUE_KEYS = ['otp', 'code', 'data.otp', 'data.code']

function pluckByPath(obj, dottedPath) {
  return dottedPath.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj)
}

function extractOtpValue(body) {
  for (const key of OTP_VALUE_KEYS) {
    const value = pluckByPath(body, key)
    if (value != null) return String(value)
  }
  return null
}

export async function fetchQaOtp({ user, brand, scope }) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(QA_OTP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user, whitelabel: brand, scope }),
      signal: controller.signal,
    })

    if (!res.ok) return { ok: false, error: `QA API ${res.status}` }

    const body = await res.json().catch(() => null)
    if (body == null) return { ok: false, error: 'QA API 回應不是合法 JSON' }

    const otp = extractOtpValue(body)
    if (otp == null) return { ok: false, error: 'unexpected response shape', raw: body }

    return { ok: true, otp }
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, error: `QA API 逾時（${TIMEOUT_MS}ms）` }
    return { ok: false, error: err.message }
  } finally {
    clearTimeout(timeout)
  }
}
