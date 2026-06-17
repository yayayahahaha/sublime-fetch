// 共享 helper：給 mock route 用的 response handler
// 主要功能是把 mock label 寫進 res.locals，讓 server.js 的 logger middleware 知道
// 這是 mock 命中（而不是 proxy），順帶處理 errorEnvelope 那種帶 _httpStatus 的 payload
export const respond = (label, payload) => (req, res) => {
  res.locals._mockLabel = label
  if (payload && typeof payload === 'object' && '_httpStatus' in payload) {
    return res.status(payload._httpStatus).json(payload.body)
  }
  res.json(payload)
}
