// 簡單的 ws client 範例 — 不用開前端, 直接看 ws mock 跑起來的樣子。
//
// 用法:
//   終端 1: 啟動 mock server (t99 → Mock Server, ws-domain 選「🚫 不啟用」即可)
//   終端 2: node mock-server/ws/examples/demo-client.js [port]   # port 預設 3000
//
// 流程 (共 15 秒):
//   連線 /ws/demo-feed → ping → subscribe systemEvent + fast-tick
//   → 8 秒後 unsubscribe fast-tick (只留 systemEvent) → 15 秒後關閉
import WebSocket from 'ws'

const port = process.argv[2] ?? 3000
const url = `ws://localhost:${port}/ws/demo-feed`

console.log(`連線到 ${url} ...`)
const ws = new WebSocket(url)

ws.on('error', (err) => {
  console.error(`連線失敗: ${err.message} (mock server 有開嗎?)`)
  process.exit(1)
})

ws.on('open', () => {
  console.log('✓ 已連線')
  console.log('→ ping')
  ws.send('ping')
  console.log('→ subscribe: systemEvent, fast-tick')
  ws.send(JSON.stringify({ op: 'subscribe', args: ['systemEvent', 'fast-tick'] }))
})

// fast-tick 是 50ms 一幀的高頻推送 — 前 3 幀逐條印, 之後每秒彙總一行
let fastShown = 0
let fastPerSecond = 0
setInterval(() => {
  if (fastPerSecond > 0 && fastShown >= 3) {
    console.log(`← fast-tick ... 這 1 秒共 ${fastPerSecond} 幀`)
  }
  fastPerSecond = 0
}, 1000).unref()

ws.on('message', (raw) => {
  const text = raw.toString()
  if (text === 'pong') return console.log('← pong')

  const msg = JSON.parse(text)
  if (msg.event) return console.log(`← ack: ${text}`)

  if (msg.topic === 'fast-tick') {
    fastPerSecond++
    if (fastShown < 3) {
      fastShown++
      console.log(`← fast-tick seq=${msg.data.seq} price=${msg.data.price}${fastShown === 3 ? '  (高頻幀之後改成每秒彙總)' : ''}`)
    }
    return
  }

  console.log(`← ${text}`)
})

setTimeout(() => {
  console.log('→ unsubscribe: fast-tick (systemEvent 續訂)')
  ws.send(JSON.stringify({ op: 'unsubscribe', args: ['fast-tick'] }))
}, 8000)

setTimeout(() => {
  console.log('示範結束, 關閉連線')
  ws.close()
  process.exit(0)
}, 15000)
