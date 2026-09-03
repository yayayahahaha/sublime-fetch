import net from 'net'
import { input } from '@inquirer/prompts'
import { startServer } from './server.js'
import { lightGreen, cyan, red } from '../color.js'

// 試綁一個 port：能 listen → 可用；EADDRINUSE → 已被占用。回 { ok, code }。
function checkPort(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', (err) => resolve({ ok: false, code: err.code }))
    srv.once('listening', () => srv.close(() => resolve({ ok: true })))
    srv.listen(port)
  })
}

async function promptPort() {
  const answer = await input({
    message: '要用哪個 port？',
    default: '4021',
    validate: async (v) => {
      const s = String(v ?? '').trim()
      if (!/^\d+$/.test(s)) return '請輸入數字 port'
      const n = Number(s)
      if (n < 1 || n > 65535) return 'port 需在 1–65535 之間'
      const r = await checkPort(n)
      if (r.ok) return true
      if (r.code === 'EADDRINUSE') return `port ${n} 已被占用，請換一個`
      return `port ${n} 無法使用（${r.code ?? '未知錯誤'}）`
    },
  })
  return Number(String(answer).trim())
}

export async function otpProxyMenu() {
  let port
  try {
    port = await promptPort()
  } catch (e) {
    if (e?.name === 'ExitPromptError') return
    console.error(red(`prompt error: ${e.message}`))
    return
  }

  try {
    await startServer({ port })
  } catch (e) {
    console.error(red(`啟動失敗: ${e.message}`))
    return
  }

  console.log(cyan(`📡 QA OTP + 本地 2FA 都會併在一起回：POST http://localhost:${port}/get-otp`))
  console.log(lightGreen(`範例： curl -X POST http://localhost:${port}/get-otp -H 'Content-Type: application/json' -d '{"user":"fc4btsestaging","brand":"btse"}'`))
  console.log(cyan(`📡 查已存的登入 profile（account/password/2FA）：GET http://localhost:${port}/profiles`))
  console.log(lightGreen(`範例： curl 'http://localhost:${port}/profiles?brand=btse&username=fc4'`))
  console.log(cyan('Ctrl+C 結束\n'))
}
