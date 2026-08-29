// mode: 'mock' 範例 — 純假資料, 不需要 ws-domain 也能用。
// 測法: 前端 (或 wscat) 連 ws://localhost:3000/ws/demo-feed
//   → 送 {"op":"subscribe","args":["systemEvent","fast-tick"]}
//   → 會收到 ack {"event":"subscribe","channel":[...]} 和各 topic 的定時推送
import { createFeedMock } from '../feed-mock.js'

export default createFeedMock({
  path: '/ws/demo-feed',
  topics: {
    // 慢速: 模擬低頻的系統事件
    systemEvent: {
      intervalMs: 3000,
      make: (i) => ({
        topic: 'systemEvent',
        data: { seq: i, event: 'DEMO_EVENT', at: new Date().toISOString() },
      }),
    },
    // 高頻: 模擬行情 tick, 想壓測就把 intervalMs 調更小
    'fast-tick': {
      intervalMs: 50,
      make: (i) => ({
        topic: 'fast-tick',
        data: { seq: i, price: (100 + Math.sin(i / 20) * 5).toFixed(2) },
      }),
    },
  },
})
