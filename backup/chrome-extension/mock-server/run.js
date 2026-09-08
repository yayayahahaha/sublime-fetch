// 非互動的薄 entry，兩種呼叫方式都支援：
//   1. 被 index.js 以 child process fork 起來（hot reload 用），設定透過環境變數傳入，
//      因為每次重啟都是全新 process。
//   2. 直接被 CLI / agent 呼叫，用 --flag 傳參數：
//        node mock-server/run.js --default-api-domain https://... --port 3005 --modules affiliate,init-wallet
//      CLI flag 優先於環境變數。
import { startServer } from './server.js'
import { red } from '../color.js'

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    if (key === 'show-bypass') {
      out.showBypass = true
      continue
    }
    out[key] = argv[i + 1]
    i++
  }
  return out
}

const args = parseArgs(process.argv.slice(2))

const defaultApiDomain = args['default-api-domain'] ?? process.env.MOCK_DEFAULT_API_DOMAIN
const port = Number(args.port ?? process.env.MOCK_PORT) || 3000
const showBypass = args.showBypass === true || process.env.MOCK_SHOW_BYPASS === '1'
const wsDomain = args['ws-domain'] ?? process.env.MOCK_WS_DOMAIN ?? null
// 有指定 modules（含空字串）→ 用它（空字串 = 都不載入）；完全沒指定 → null（全部載入）
const parseModulesArg = (v) =>
  v != null ? v.split(',').map((s) => s.trim()).filter(Boolean) : null
const modules = parseModulesArg(args.modules ?? process.env.MOCK_MODULES)
const wsModules = parseModulesArg(args['ws-modules'] ?? process.env.MOCK_WS_MODULES)

startServer({ defaultApiDomain, port, showBypass, wsDomain, modules, wsModules }).catch((e) => {
  console.error(red(`啟動失敗: ${e.message}`))
  process.exit(1)
})
