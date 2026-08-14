// 被 index.js 以 child process fork 起來的薄 entry（hot reload 用）。
// 設定透過環境變數傳入，因為每次重啟都是全新 process。
// 直接跑這支也可以：MOCK_DEFAULT_API_DOMAIN=https://... node mock-server/run.js
import { startServer } from './server.js'
import { red } from '../color.js'

const defaultApiDomain = process.env.MOCK_DEFAULT_API_DOMAIN
const port = Number(process.env.MOCK_PORT) || 3000
const showBypass = process.env.MOCK_SHOW_BYPASS === '1'
const wsDomain = process.env.MOCK_WS_DOMAIN || null
// 有設 MOCK_MODULES（含空字串）→ 用它（空字串 = 都不載入）；完全沒設 → null（全部載入）
const parseModulesEnv = (v) =>
  v != null ? v.split(',').map((s) => s.trim()).filter(Boolean) : null
const modules = parseModulesEnv(process.env.MOCK_MODULES)
const wsModules = parseModulesEnv(process.env.MOCK_WS_MODULES)

startServer({ defaultApiDomain, port, showBypass, wsDomain, modules, wsModules }).catch((e) => {
  console.error(red(`啟動失敗: ${e.message}`))
  process.exit(1)
})
