// WebSocket upgrade 路由核心。
// 分流規則（跟 HTTP mock 同精神：先查註冊清單，再 fallback）：
//   1. path 被某個 ws mock 認領 → 歸它管（真後端的同名 endpoint 會被遮蔽）
//        mode: 'mock'   → 本地假資料，完全不碰 upstream（沒有 ws-domain 也能用）
//        mode: 'tamper' → 中間人轉發到真後端，hook 可篡改（需要 ws-domain 或模組自帶 upstreamDomain）
//   2. 沒被認領 → 有 ws-domain 就透明 proxy 過去；沒有就關閉連線
//
// 想加新的 ws mock：在 ws/mocks/ 丟一個檔即可（自動掃描；.js 物件 或 .ws.json 宣告式）。
// wsMocks 由 server.js 依「選到的模組」載入後傳進來（見 load-ws-mocks.js）。
import { WebSocketServer } from 'ws'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { ts, pad, dim, red, green, yellow, cyan } from '../log-utils.js'
import { createTamperPair } from './tamper.js'

const VALID_MODES = ['mock', 'tamper']

function validateMocks(mocks) {
  const seen = new Set()
  for (const mock of mocks) {
    if (!mock?.path || !mock.path.startsWith('/')) {
      throw new Error(`ws mock 缺少合法的 path (要以 / 開頭): ${JSON.stringify(mock?.path)}`)
    }
    if (!VALID_MODES.includes(mock.mode)) {
      throw new Error(`ws mock ${mock.path} 的 mode 必須是 ${VALID_MODES.join(' | ')}, 拿到: ${mock.mode}`)
    }
    if (mock.mode === 'mock' && typeof mock.handle !== 'function') {
      throw new Error(`ws mock ${mock.path} (mode: mock) 必須提供 handle(client, ctx) 函式`)
    }
    if (seen.has(mock.path)) {
      throw new Error(`ws mock path 重複認領: ${mock.path} (同一個 path 只能有一種身分)`)
    }
    seen.add(mock.path)
  }
}

function logLine(symbol, path, label) {
  console.log(`${dim(ts())} ${symbol}  ${pad('WS', 6)} ${pad(path, 56)} ${label}`)
}

/**
 * 把 ws 路由掛上現有的 http server (同 port)。
 * @param {import('http').Server} server
 * @param {object} options
 * @param {string|null} options.wsDomain - ws(s):// 開頭的真實後端。null = 不啟用轉發
 * @param {Array} [options.wsMocks=[]] - 已載入的 ws mock 物件（server.js 依選到的模組載入後傳入）
 */
export function attachWsRouter(server, { wsDomain = null, wsMocks = [] } = {}) {
  validateMocks(wsMocks)

  // 啟動時先把「因為沒 upstream 而停用」的 tamper mock 警告出來
  for (const mock of wsMocks) {
    if (mock.mode === 'tamper' && !(mock.upstreamDomain ?? wsDomain)) {
      console.log(
        yellow(`⚠ ws mock ${mock.path} (mode: tamper) 已停用: 未設定 ws-domain 且模組沒有 upstreamDomain`)
      )
    }
  }

  const wss = new WebSocketServer({ noServer: true })

  // catch-all ws proxy — 只在有 wsDomain 時建立
  const catchAllProxy = wsDomain
    ? createProxyMiddleware({
        target: wsDomain,
        ws: true,
        changeOrigin: true,
        secure: false, // 允許 self-signed cert
        logger: { info: () => {}, warn: console.warn, error: console.error },
        on: {
          error: (err, req) => {
            logLine(red('✗'), req?.url ?? '?', red(`ws proxy error: ${err.message}`))
          },
        },
      })
    : null

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost')
    const mock = wsMocks.find((m) => m.path === pathname)

    // ─── 沒被認領 → catch-all proxy 或關閉 ───
    if (!mock) {
      if (catchAllProxy) {
        logLine(dim('⇅'), req.url, cyan(`[ws-proxy → ${wsDomain}]`))
        catchAllProxy.upgrade(req, socket, head)
      } else {
        logLine(red('✗'), req.url, red('未啟用 WS 轉發, 且沒有 ws mock 認領這個 path → 關閉連線'))
        socket.destroy()
      }
      return
    }

    // ─── mode: tamper ───
    if (mock.mode === 'tamper') {
      const upstreamDomain = mock.upstreamDomain ?? wsDomain
      if (!upstreamDomain) {
        logLine(red('✗'), req.url, red(`[ws-tamper] ${mock.path} 已停用 (沒有 upstream) → 關閉連線`))
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (client) => {
        logLine(green('⇅'), req.url, cyan(`[ws-tamper → ${upstreamDomain}] client connected`))
        createTamperPair(client, req, mock, upstreamDomain, {
          log: (label) => logLine(dim('·'), mock.path, cyan(`[ws-tamper] ${label}`)),
        })
        client.on('close', () => logLine(dim('⇆'), mock.path, cyan('[ws-tamper] client disconnected')))
      })
      return
    }

    // ─── mode: mock ───
    wss.handleUpgrade(req, socket, head, (client) => {
      logLine(green('⇅'), req.url, green(`[ws-mock:${mock.path}] client connected`))

      // ctx.setInterval: 連線 close 時自動 clear, 防止對死連線狂推的殭屍 timer
      const timers = new Set()
      const ctx = {
        log: (label) => logLine(dim('·'), mock.path, green(`[ws-mock] ${label}`)),
        setInterval: (fn, ms) => {
          const id = setInterval(fn, ms)
          timers.add(id)
          return id
        },
        clearInterval: (id) => {
          clearInterval(id)
          timers.delete(id)
        },
      }
      client.on('close', () => {
        timers.forEach(clearInterval)
        timers.clear()
        logLine(dim('⇆'), mock.path, green('[ws-mock] client disconnected'))
      })

      try {
        mock.handle(client, ctx)
      } catch (err) {
        logLine(red('✗'), mock.path, red(`[ws-mock] handle 拋出錯誤: ${err.message}`))
        client.close()
      }
    })
  })
}
