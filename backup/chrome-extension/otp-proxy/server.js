import express from 'express'
import { fetchQaOtp } from './qaClient.js'
import { loadLoginProfiles, getSecret } from './secrets-storage.js'
import { gen2FaCode } from '../auto-login/2fa.js'
import { blue, green, red } from '../color.js'

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
      console.log(`\n🚀 OTP proxy listening on http://localhost:${port}`)
      resolve(server)
    })
  })
}
