// mode: 'tamper' 範例 — 中間人轉發到真後端, 途中動手腳。
// upstream 預設用啟動時輸入的 ws-domain; 想固定連別的 domain 可以宣告 upstreamDomain 覆蓋。
//
// 兩個 hook 都是「沒定義 = 原樣轉發」:
//   onClientMessage(raw, ctx)   — 上行經過時呼叫 (可攔 subscribe 改參數)
//   onUpstreamMessage(raw, ctx) — 下行經過時呼叫
// 回傳值會被轉發; 回傳 null = 吞掉這一幀 (模擬掉訊息);
// ctx.sendToClient(x) / ctx.sendUpstream(x) 可額外插幀 (模擬重複推送、假 event)。
export default {
  path: '/ws/demo-tamper',
  mode: 'tamper',
  // upstreamDomain: 'wss://another-push-domain.example', // 需要時再打開

  onUpstreamMessage(raw) {
    // 示範: 把 JSON 幀塞一個 tampered 標記再放行, 非 JSON 幀原樣透傳
    try {
      const msg = JSON.parse(raw)
      msg.tampered = true
      return JSON.stringify(msg)
    } catch {
      return raw
    }
  },
}
