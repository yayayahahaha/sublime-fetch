// 非互動的薄 entry，給 CLI / agent 直接呼叫用（不用走 index.js 的 inquirer 問答）：
//   node otp-proxy/run.js --port 4021
// 或用環境變數：OTP_PORT=4021 node otp-proxy/run.js
// 沒指定就用預設 port 4021（跟 index.js 互動版一致）。
import { startServer } from './server.js'
import { red } from '../color.js'

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    out[arg.slice(2)] = argv[i + 1]
    i++
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const port = Number(args.port ?? process.env.OTP_PORT) || 4021

startServer({ port }).catch((e) => {
  console.error(red(`啟動失敗: ${e.message}`))
  process.exit(1)
})
