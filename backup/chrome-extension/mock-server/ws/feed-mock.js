// 宣告式的 mode: 'mock' 框架。
// 訂閱協議 (op/args 上行, event/channel ack 下行) 和 timer 生命週期都在這層包掉,
// mock 檔只要宣告「哪些 topic、多久推一次、資料長什麼樣」:
//
//   export default createFeedMock({
//     path: '/ws/xxx',
//     topics: {
//       systemEvent: { intervalMs: 3000, make: (i) => ({ topic: 'systemEvent', data: {...} }) },
//     },
//   })
//
// make(i) 的 i 是該 topic 的 tick 序號 (0 起算), 方便做遞增序列。
// 要跳出框架做特殊行為 (模擬斷線、亂序等), 直接寫裸的 { path, mode: 'mock', handle } 即可。
export function createFeedMock({ path, topics = {} }) {
  if (!path) throw new Error('createFeedMock: path 為必填')

  return {
    path,
    mode: 'mock',
    handle(client, ctx) {
      // 每條連線各自獨立的訂閱狀態 (多分頁互不影響)
      const running = new Map() // topic → intervalId

      const startTopic = (topic) => {
        if (running.has(topic)) return // 重複 subscribe 不疊 timer
        const def = topics[topic]
        if (!def) {
          ctx.log(`subscribe 了未宣告的 topic: ${topic} (照 ack, 但不會有資料推送)`)
          return
        }
        let tick = 0
        const id = ctx.setInterval(() => {
          client.send(JSON.stringify(def.make(tick++)))
        }, def.intervalMs)
        running.set(topic, id)
      }

      const stopTopic = (topic) => {
        const id = running.get(topic)
        if (id == null) return
        ctx.clearInterval(id)
        running.delete(topic)
      }

      client.on('message', (data) => {
        const text = data.toString()

        // ping/pong: 真實格式未確認, 純文字和 JSON 兩種都認、對稱回覆
        if (text === 'ping') return client.send('pong')

        let msg
        try {
          msg = JSON.parse(text)
        } catch {
          return ctx.log(`收到無法解析的訊息: ${text.slice(0, 120)}`)
        }

        if (msg.op === 'ping') return client.send(JSON.stringify({ op: 'pong' }))

        if (msg.op === 'subscribe') {
          const args = Array.isArray(msg.args) ? msg.args : []
          client.send(JSON.stringify({ event: 'subscribe', channel: args }))
          args.forEach(startTopic)
          ctx.log(`subscribed: ${args.join(', ')}`)
          return
        }

        if (msg.op === 'unsubscribe') {
          const args = Array.isArray(msg.args) ? msg.args : []
          client.send(JSON.stringify({ event: 'unsubscribe', channel: args }))
          args.forEach(stopTopic)
          ctx.log(`unsubscribed: ${args.join(', ')}`)
          return
        }

        ctx.log(`收到未支援的 op: ${msg.op}`)
      })
      // timer 清理不用自己做: ctx.setInterval 在連線 close 時會全部自動 clear
    },
  }
}
