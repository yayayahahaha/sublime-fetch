// mode: 'tamper' 的中間人配對邏輯。
// 每一條前端連線都會撥一條對應的 upstream 連線到真後端，雙向轉發。
// mock 檔透過 hook 決定要不要「動手腳」，沒定義的 hook = 原樣轉發：
//   onClientMessage(raw, ctx)   — 上行 (前端 → 真後端) 經過時呼叫
//   onUpstreamMessage(raw, ctx) — 下行 (真後端 → 前端) 經過時呼叫
//   hook 回傳值會被轉發 (可以是修改過的)；回傳 null/undefined = 吞掉這一幀
//   ctx.sendToClient(x) / ctx.sendUpstream(x) 可以額外插幀
// hook throw 的話：印錯誤、該幀原樣放行 (mock 寫壞不該弄斷資料流)。
import WebSocket from 'ws'
import { yellow, red } from '../log-utils.js'

// 這些 close code 不能主動帶著再 close 一次 (ws 會 throw invalid code)
const isReusableCloseCode = (code) =>
  Number.isInteger(code) && code >= 1000 && code <= 4999 && ![1004, 1005, 1006, 1015].includes(code)

const STATS_FLUSH_MS = 1000

export function createTamperPair(client, req, mock, upstreamDomain, { log }) {
  const upstreamUrl = new URL(req.url, upstreamDomain).toString()
  const upstream = new WebSocket(upstreamUrl, { rejectUnauthorized: false })

  const pendingToUpstream = [] // upstream 還沒 open 前, 上行訊息先排隊
  const stats = { up: 0, down: 0, tampered: 0, dropped: 0 }

  // 透傳幀是高頻的, 不逐條印 — 每秒彙總一行 (沒流量就不印)
  const statsTimer = setInterval(() => {
    if (stats.up === 0 && stats.down === 0) return
    const extra =
      (stats.tampered ? ` tampered ${stats.tampered}` : '') +
      (stats.dropped ? ` dropped ${stats.dropped}` : '')
    log(`↓${stats.down} ↑${stats.up} msgs/s${extra}`)
    stats.up = stats.down = stats.tampered = stats.dropped = 0
  }, STATS_FLUSH_MS)

  const ctx = {
    sendToClient: (data) => {
      if (client.readyState === WebSocket.OPEN) client.send(data)
    },
    sendUpstream: (data) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data)
      else pendingToUpstream.push(data)
    },
    log,
  }

  // 套 hook：回傳「要轉發的資料」，null = 吞掉。hook 出錯 → 原樣放行
  const applyHook = (hook, raw) => {
    if (typeof hook !== 'function') return raw
    let out
    try {
      out = hook.call(mock, raw, ctx)
    } catch (err) {
      console.error(red(`[ws-tamper] ${mock.path} hook 拋出錯誤, 該幀原樣放行: ${err.message}`))
      return raw
    }
    if (out == null) {
      stats.dropped++
      return null
    }
    if (out !== raw) stats.tampered++
    return out
  }

  // ─── 上行: client → upstream ───
  client.on('message', (data, isBinary) => {
    const raw = isBinary ? data : data.toString()
    const out = applyHook(mock.onClientMessage, raw)
    if (out == null) return
    stats.up++
    if (upstream.readyState === WebSocket.OPEN) upstream.send(out)
    else pendingToUpstream.push(out)
  })

  // ─── 下行: upstream → client ───
  upstream.on('open', () => {
    for (const data of pendingToUpstream.splice(0)) upstream.send(data)
  })
  upstream.on('message', (data, isBinary) => {
    const raw = isBinary ? data : data.toString()
    const out = applyHook(mock.onUpstreamMessage, raw)
    if (out == null) return
    stats.down++
    if (client.readyState === WebSocket.OPEN) client.send(out)
  })

  // ─── 生命週期: 一方關了就帶同樣的 code/reason 關另一方 ───
  let closing = false
  const closeOther = (other, code, reason) => {
    clearInterval(statsTimer)
    if (closing) return
    closing = true
    if (other.readyState === WebSocket.OPEN || other.readyState === WebSocket.CONNECTING) {
      if (isReusableCloseCode(code)) other.close(code, reason)
      else other.close()
    }
  }

  client.on('close', (code, reason) => closeOther(upstream, code, reason))
  upstream.on('close', (code, reason) => closeOther(client, code, reason))
  client.on('error', (err) => {
    console.error(yellow(`[ws-tamper] ${mock.path} client error: ${err.message}`))
    closeOther(upstream)
  })
  upstream.on('error', (err) => {
    console.error(yellow(`[ws-tamper] ${mock.path} upstream error (${upstreamUrl}): ${err.message}`))
    closeOther(client)
  })
}
