import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware'

const DECL_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch'])

// 共享 helper：給 mock route 用的 response handler
// 主要功能是把 mock label 寫進 res.locals，讓 server.js 的 logger middleware 知道
// 這是 mock 命中（而不是 proxy），順帶處理 errorEnvelope 那種帶 _httpStatus 的 payload
//
// 這是 HTTP 的「全取代」mode（對應 ws 的 mode: 'mock'）：整包回應由你決定。
export const respond = (label, payload) => (req, res) => {
  res.locals._mockLabel = label
  if (payload && typeof payload === 'object' && '_httpStatus' in payload) {
    return res.status(payload._httpStatus).json(payload.body)
  }
  res.json(payload)
}

/**
 * HTTP 的「proxy 真後端 → 改回應」mode（對應 ws 的 mode: 'tamper'）。
 * 格式無關：把真後端回來的原始回應交給你，你回傳什麼就送什麼——JSON / HTML / 純文字 / binary
 * 都行，怎麼解讀是 mock 自己的事（JSON 情境可搭配下面的 asJson）。
 *
 * 用法：app.use('/api/xxx', tamper(defaultApiDomain, { label, modify }))
 *
 * @param {string} defaultApiDomain - proxy 目標（跟 catch-all 同一個真後端）
 * @param {object} opts
 * @param {string} opts.label - log 標籤，會顯示成 [mock:label ...]
 * @param {(text:string, ctx:{req,res,proxyRes,status:number,buffer:Buffer})=>(string|Buffer|void|Promise<string|Buffer|void>)} opts.modify
 *   - 第一個參數是 utf8 解碼後的回應內容；binary 情境用 ctx.buffer 拿原始 Buffer
 *   - 回傳 string / Buffer → 送出那個；回傳 undefined/null → 原樣放行（不改）
 *   - modify 內可自行寫 res.locals._mockLabel 蓋掉預設標籤（想帶更多細節時）
 *   - modify 丟錯時原樣放行（不因為 mock 寫壞而弄斷真資料流）
 */
export function tamper(defaultApiDomain, { label, modify } = {}) {
  if (!defaultApiDomain) throw new Error('tamper: defaultApiDomain is required')
  if (typeof modify !== 'function') throw new Error('tamper: modify 必須是函式')

  const proxy = createProxyMiddleware({
    target: defaultApiDomain,
    changeOrigin: true,
    secure: false, // 允許 self-signed cert
    selfHandleResponse: true, // responseInterceptor 必須搭配這個
    logger: { info: () => {}, warn: console.warn, error: console.error },
    on: {
      // 跟 catch-all proxy 一致：拿掉 Origin，避免嚴格的 brand gateway（如 btse api.btse.co）
      // 把帶 Origin 的 proxy 請求當跨域擋掉（400/403）。
      proxyReq: (proxyReq) => {
        proxyReq.removeHeader('origin')
      },
      proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
        let out
        try {
          out = await modify(responseBuffer.toString('utf8'), {
            req,
            res,
            proxyRes,
            status: proxyRes.statusCode,
            buffer: responseBuffer,
          })
        } catch (e) {
          res.locals._mockLabel = `${label} (modify 出錯, passthrough: ${e.message})`
          return responseBuffer
        }
        if (out == null) {
          if (res.locals._mockLabel == null) res.locals._mockLabel = `${label} (passthrough)`
          return responseBuffer
        }
        if (res.locals._mockLabel == null) res.locals._mockLabel = `${label} (tampered)`
        return out
      }),
    },
  })

  // http-proxy-middleware 用 req.url 轉發，但 Express 的 app.use('/path', ...) 會把 mount
  // path 從 req.url 剝掉 (只剩 '/')，導致 proxy 打錯真後端路徑。還原成 originalUrl 再交給 proxy，
  // 讓它不管是 app.use(path, ...) 還是 app.get(path, ...) 掛法都轉發到正確的完整路徑。
  return (req, res, next) => {
    if (req.originalUrl) req.url = req.originalUrl
    return proxy(req, res, next)
  }
}

/**
 * tamper 的「JSON 便利組合子」（可選）。把 tamper 給的原始文字 parse 成物件交給 fn，
 * fn 改完回傳新物件或就地改，再幫你 stringify 回去。非 JSON 自動原樣放行（回 undefined）。
 *
 * 用法：tamper(domain, { label, modify: asJson((body, ctx) => { body.data.x = 1 }) })
 *
 * @param {(body:any, ctx:object)=>any} fn - 回傳新物件 → 送出；回傳 undefined → 沿用就地修改
 */
export function asJson(fn) {
  return (text, ctx) => {
    let body
    try {
      body = JSON.parse(text)
    } catch {
      return // 非 JSON → 原樣放行
    }
    const out = fn(body, ctx)
    return JSON.stringify(out === undefined ? body : out)
  }
}

/**
 * 由「宣告式 spec」建出 register(app)。給 .mock.json 模組用（由「新增 Mock API」產生）。
 * 只支援 mode: 'respond'——每次 request 重讀 responseFile 再整包回傳（真實 API 完全不會被呼叫）。
 * tamper（proxy 後改）因為要寫邏輯，走獨立 .js 模組，不在宣告式範圍。
 *
 * @param {{routes: Array<{method, path, mode?, responseFile, label?}>}} spec
 * @param {{dir: string}} opts - spec 檔所在目錄（mocks/），responseFile 相對於它解析
 */
export function buildDeclarativeRegister(spec, { dir }) {
  const routes = Array.isArray(spec?.routes) ? spec.routes : []
  return function register(app) {
    for (const r of routes) {
      const method = String(r.method || 'get').toLowerCase()
      const label = r.label || `${method.toUpperCase()} ${r.path}`
      if (!DECL_METHODS.has(method)) {
        throw new Error(`宣告式 mock route ${label}: 不支援的 method '${r.method}'`)
      }
      if (r.mode && r.mode !== 'respond') {
        throw new Error(`宣告式 mock 只支援 mode: 'respond'（拿到 '${r.mode}'）；tamper 請用獨立 .js 模組`)
      }
      if (!r.path) throw new Error('宣告式 mock route 缺少 path')
      if (!r.responseFile) throw new Error(`宣告式 mock route ${label} 缺少 responseFile`)

      const filePath = path.resolve(dir, r.responseFile)
      app[method](r.path, (req, res) => {
        let payload
        try {
          payload = JSON.parse(readFileSync(filePath, 'utf8')) // 每次 request 重讀，改 json 免重啟
        } catch (err) {
          res.locals._mockLabel = `${label} (responseFile 讀取失敗: ${err.message})`
          return res.status(500).json({ error: `mock data 讀取失敗: ${err.message}` })
        }
        res.locals._mockLabel = label
        res.json(payload)
      })
    }
  }
}
