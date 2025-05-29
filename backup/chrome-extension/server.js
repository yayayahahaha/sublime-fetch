import express from 'express'
import { connectRedis } from './redis.js'
import { Response } from './request-stuff.js'
import { setting } from './WL.js'
import { LoginNeeded } from './login-stuff.js'
const app = express()
const port = 9999

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

// 設定基本路由
app.get('/', (req, res) => res.send('turn BACK 🚶‍♂️'))

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

// 啟動伺服器
app.listen(port, () => {
  console.log(`Express 伺服器已啟動，監聽 port ${port}`)
})
