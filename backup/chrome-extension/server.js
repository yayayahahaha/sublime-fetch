import express from 'express'
import { connectRedis } from './redis.js'
import { Response } from './request-stuff.js'
import { setting } from './WL.js'
import { LoginNeeded } from './login-stuff.js'
const app = express()

const settingMapping = Object.fromEntries(setting.map((item) => [item.pk, item]))
// 添加暫存登入結果的物件
const loginCache = new Map()

const redis = connectRedis()

// 添加 CORS 中間件，支援所有來源
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization')
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')

  // 處理 OPTIONS 請求
  if (req.method === 'OPTIONS') return res.sendStatus(200)

  next()
})

// 解析 JSON 請求體
app.use(express.json())
app.use(express.json())
app.use(
  express.urlencoded({
    extended: true,
  })
)

// 設定基本路由
app.get('/', (req, res) => res.send(new Response({ data: 'turn BACK 🚶‍♂️' })))

app.post('/login', async (req, res) => {
  const {
    email = null,
    brandName = null,
    password = null,
    secretCode2Fa = null,
    deviceFingerprint = null,
  } = req.body ?? {}
  switch (true) {
    case email == null:
    case password == null:
      res.send(new Response({ error: 'email 和 password 為必填' }))
      return
  }

  let payload
  try {
    payload = new LoginNeeded({
      email,
      brandName,
      password,
      secretCode2Fa,
      deviceFingerprint: deviceFingerprint ?? `${brandName}-${email}-fingerprint-mock`,
      // deviceFingerprint: deviceFingerprint ?? `_oaanym1747972414766`,
    })
  } catch (e) {
    res.send(new Response({ error: e.message }))
    return
  }
  const result = await payload.login()

  res.send(new Response({ data: result, error: result.error }))
  console.log('\n\n')
})

app.get('/login-by-pk', async (req, res) => {
  const { pk } = req.query
  if (!pk) {
    return res.send(new Response({ error: 'pk are required' }))
  }

  const payload = settingMapping[pk]
  if (payload == null) return res.send(new Response({ error: `pk 沒有在 setting 裡` }))

  console.log(`\x1b[1m\x1b[36m${'事前參數準備'}\x1b[0m`)
  console.log('🌠 檢查是否有暫存的登入 token:')
  const cachedResult = loginCache.get(pk)
  if (cachedResult) {
    console.log('  > 存在暫存的 token: ', cachedResult)
    console.log(`🔄 使用暫存的登入結果, 對應的 pk: ${pk}`)
    payload.token = cachedResult.token
  } else {
    console.log('  > 不存在暫存的 token')
  }

  const result = await payload.login()

  // 如果登入成功，儲存結果到暫存
  if (result?.token) {
    console.log(`💾 儲存登入結果到暫存，pk: ${pk}`)
    loginCache.set(pk, result)
  }
  console.log('\n\n')

  res.send(new Response({ data: result }))
})

app.get('/getOtp', async (req, res) => {
  const { username, brandName = null } = req.query
  if (!username) {
    return res.send(new Response({ error: 'username is required' }))
  }

  const { error, value } = await redis.getUserOtp(username, brandName)
  if (error != null) return res.send(new Response({ error, data: value }))
  res.send(new Response({ data: value }))
})

app.get('/getCaptcha', async (req, res) => {
  const { captchaId } = req.query
  if (!captchaId) {
    return res.send(new Response({ error: 'captchaId is required' }))
  }

  const { error, value } = await redis.getCaptcha(captchaId)
  if (error != null) return res.send(new Response({ error, data: value }))
  res.send(new Response({ data: value }))
})

// 處理未定義的路由
app.use((req, res) => {
  res.status(404).send(new Response({ data: 'turn BACK 🚶‍♂️' }))
})
// 處理錯誤
app.use((err, req, res, next) => {
  console.error('伺服器錯誤:', err)
  res.status(500).send(new Response({ error: '伺服器內部錯誤' }))
})
// 設定伺服器監聽的 port
const port = process.env.PORT || 9999
// 設定伺服器監聽的 port
app.set('port', port)

// 啟動伺服器
app.listen(port, () => {
  console.log(`Express 伺服器已啟動，監聽 port ${port}`)
})
