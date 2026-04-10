import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { gen2FaCode, get2FaTimeRemaining } from './2fa.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const filePath = path.resolve(dirname, '2fa-storage.json')

const app = express()
const PORT = 9999

// 允許跨網域存取 (CORS)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET')
  next()
})

function load2FaStorage() {
  if (!fs.existsSync(filePath)) return []
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return []
  }
}

function parseOtpauth(line) {
  try {
    const url = new URL(line)
    const secret = url.searchParams.get('secret')
    const issuer = url.searchParams.get('issuer')
    const label = decodeURIComponent(url.pathname.split(':').pop() || '')
    return { secret, issuer, label }
  } catch {
    return null
  }
}

app.get('/api/2fa', (req, res) => {
  const storage = load2FaStorage()
  const results = storage.map(line => {
    const parsed = parseOtpauth(line)
    if (!parsed) return null
    return {
      name: `${parsed.issuer} (${parsed.label})`,
      code: gen2FaCode(parsed.secret, { verbose: false }),
      remaining: get2FaTimeRemaining()
    }
  }).filter(Boolean)

  res.json(results)
})

export function startServer() {
  app.listen(PORT, () => {
    console.log(`\n🚀 2FA API Server 啟動於 http://localhost:${PORT}`)
    console.log(`🔗 API 端點: http://localhost:${PORT}/api/2fa`)
  })
}

// 如果直接執行此檔案
if (process.argv[1] === filename) {
  startServer()
}
