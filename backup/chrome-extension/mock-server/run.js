// 被 index.js 以 child process fork 起來的薄 entry（hot reload 用）。
// 設定透過環境變數傳入，因為每次重啟都是全新 process。
// 直接跑這支也可以：MOCK_DEFAULT_API_DOMAIN=https://... node mock-server/run.js
import { startServer } from './server.js'
import { red } from '../color.js'

const defaultApiDomain = process.env.MOCK_DEFAULT_API_DOMAIN
const showBypass = process.env.MOCK_SHOW_BYPASS === '1'
const wsDomain = process.env.MOCK_WS_DOMAIN || null

startServer({ defaultApiDomain, showBypass, wsDomain }).catch((e) => {
  console.error(red(`啟動失敗: ${e.message}`))
  process.exit(1)
})
