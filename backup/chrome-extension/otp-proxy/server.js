import express from 'express'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { fetchQaOtp } from './qaClient.js'
import { loadLoginProfiles, getSecret } from './secrets-storage.js'
import { gen2FaCode } from '../auto-login/2fa.js'
import { blue, green, red } from '../color.js'
import { registerPidFile } from '../pid-file.js'

function pluckOtp(settled) {
  if (settled.status !== 'fulfilled') return { value: null, error: settled.reason?.message ?? String(settled.reason) }
  const r = settled.value
  return r.ok ? { value: r.otp, error: null } : { value: null, error: r.error }
}

function matchesBrand(profile, brand) {
  return !brand || profile.brandName === brand
}

function matchesUsername(profile, username) {
  if (!username) return true
  const needle = username.toLowerCase()
  // username 是後來才補上的欄位, 舊 profile 可能還沒有, fallback 比對 email 維持相容
  return profile.username?.toLowerCase().includes(needle) || profile.email?.toLowerCase().includes(needle)
}

export async function startServer({ port }) {
  const app = express()

  /*
    開 CORS —— 這台只跑在本機、只服務測試帳號, 但瀏覽器端的自動化（agent 在
    localhost:8080 的頁面裡 fetch 這支拿 OTP）沒有這個 header 會被 preflight 擋掉。
    必須掛在路由之前, 而且要自己回 OPTIONS, 否則 preflight 會 404。
  */
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })

  app.use(express.json())

  app.post('/get-otp', async (req, res) => {
    const { user, brand } = req.body ?? {}
    if (typeof user !== 'string' || !user || typeof brand !== 'string' || !brand) {
      return res.status(400).json({ error: 'user 和 brand 都是必填的字串' })
    }

    const [paymentSettled, spotSettled] = await Promise.allSettled([
      fetchQaOtp({ user, brand, scope: 'payment' }),
      fetchQaOtp({ user, brand, scope: 'spot' }),
    ])
    const payment = pluckOtp(paymentSettled)
    const spot = pluckOtp(spotSettled)

    let secret = null
    let twoFaError = null
    try {
      secret = getSecret(loadLoginProfiles(), user, brand)
    } catch (e) {
      twoFaError = e.message
    }
    const twoFa = secret ? gen2FaCode(secret, { verbose: false }) : null

    const errors = {}
    if (payment.error) errors.payment = payment.error
    if (spot.error) errors.spot = spot.error
    if (twoFaError) errors.twoFa = twoFaError

    const body = {
      user,
      brand,
      paymentOtp: payment.value,
      spotOtp: spot.value,
      '2fa': twoFa,
      ...(Object.keys(errors).length ? { errors } : {}),
    }

    const summary = Object.keys(errors).length ? red(`payment=${!!payment.value} spot=${!!spot.value}`) : green('ok')
    console.log(`${new Date().toISOString()} ${blue('POST /get-otp')} user=${user} brand=${brand} → ${summary}`)

    return res.status(200).json(body)
  })

  /*
    吐一支 ESM module 給瀏覽器用（getProfileList / loginByUsername / inputOtp）:

      const { loginByUsername } =
        await import('http://localhost:4021/browser-helpers.js')

    每次 request 重讀檔案 —— 改 browser-helpers.js 存檔即生效, 不用重啟這台。
    跨來源 import 需要 CORS 與正確的 MIME type, 兩者都由上面那個 middleware
    與這裡的 res.type 處理。
  */
  app.get('/browser-helpers.js', (req, res) => {
    const filePath = fileURLToPath(new URL('./browser-helpers.js', import.meta.url))

    let source
    try {
      source = readFileSync(filePath, 'utf8')
    } catch (e) {
      console.log(`${new Date().toISOString()} ${blue('GET /browser-helpers.js')} → ${red(e.message)}`)
      return res.status(500).type('text/plain').send(`// 讀取失敗: ${e.message}`)
    }

    console.log(`${new Date().toISOString()} ${blue('GET /browser-helpers.js')} → ${green('ok')}`)

    // 不要讓瀏覽器 cache, 否則改完檔案還要 hard reload
    res.setHeader('Cache-Control', 'no-store')
    return res.type('application/javascript').send(source)
  })

  app.get('/profiles', (req, res) => {
    const { brand, username } = req.query

    let profiles
    try {
      profiles = loadLoginProfiles()
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }

    const filtered = profiles.filter((p) => matchesBrand(p, brand) && matchesUsername(p, username))

    console.log(`${new Date().toISOString()} ${blue('GET /profiles')} brand=${brand ?? ''} username=${username ?? ''} → ${filtered.length} 筆`)

    return res.status(200).json(filtered)
  })

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      registerPidFile('otp-proxy', port)
      console.log(`\n🚀 OTP proxy listening on http://localhost:${port}`)
      resolve(server)
    })
  })
}
