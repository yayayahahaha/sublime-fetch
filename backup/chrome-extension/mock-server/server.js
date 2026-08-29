import express from 'express'
import cors from 'cors'
import {
  createProxyMiddleware
} from 'http-proxy-middleware'

import { listMockNames, loadSelectedMocks, mountMocks } from './load-mocks.js'
import { listWsMockNames, loadWsMocks } from './ws/load-ws-mocks.js'
import {
  ts,
  pad,
  dim,
  red,
  green,
  cyan
} from './log-utils.js'
import {
  attachWsRouter
} from './ws/router.js'

/**
 * 啟動 mock server。
 * @param {object} options
 * @param {string} options.defaultApiDomain  - 真實後端 URL，沒被 mock 的 request 都會 proxy 過去
 * @param {number} [options.port=3000]       - 監聽的 port
 * @param {boolean} [options.showBypass=false] - 是否印 proxy (非 mock) 的 log
 * @param {string|null} [options.wsDomain=null] - WS 真實後端 (ws:// 或 wss://)。null = 不啟用 WS 轉發
 *   (mode 'mock' 的 ws mock 不受影響，tamper 與 catch-all ws proxy 會停用)
 * @param {string[]|null} [options.modules=null] - 要載入的 HTTP mock 模組名（檔名去副檔名）。null = 全部；[] = 都不載入
 * @param {string[]|null} [options.wsModules=null] - 要載入的 WS mock 名（同上規則）
 * @returns {Promise<import('http').Server>}
 */
export async function startServer({
  defaultApiDomain,
  port = 3000,
  showBypass = false,
  wsDomain = null,
  modules = null,
  wsModules = null
}) {
  if (!defaultApiDomain) {
    throw new Error('startServer: defaultApiDomain is required')
  }

  const app = express()

  app.use(
    cors({
      origin: true, // 反射 request 的 origin（支援 credentials）
      credentials: true,
    })
  )

  // 每個 request 都 log 兩行：→ 進來 / ← 出去（含 status, 耗時, 來源）
  // proxy 的 log 預設不印，除非 showBypass=true
  app.use((req, res, next) => {
    const startedAt = Date.now()
    const incomingTs = ts()

    res.on('finish', () => {
      const isMock = !!res.locals._mockLabel
      if (!isMock && !showBypass) return // 隱藏 proxy log（除非 showBypass）

      const elapsed = Date.now() - startedAt
      const sourceLabel = isMock ?
        green(`[mock:${res.locals._mockLabel}]`) :
        cyan(`[proxy → ${defaultApiDomain}]`)
      const statusLabel =
        res.statusCode >= 400 ?
        red(`status=${res.statusCode}`) :
        green(`status=${res.statusCode}`)

      console.log(`${dim(incomingTs)} ${dim('→')}  ${pad(req.method, 6)} ${req.originalUrl}`)
      console.log(
        `${dim(ts())} ${dim('←')}  ${pad(req.method, 6)} ${pad(req.originalUrl, 56)} ${sourceLabel} ${statusLabel} ${dim(elapsed + 'ms')}`
      )
    })

    next()
  })

  // ─── Mock routes ──────────────────────────────────────────
  // 從 mocks/ 動態載入「選到的」模組（modules=null → 全部）。每個模組 export default
  // 一個 register(app, ctx)。新增模組只要在 mocks/ 丟檔即可，不用回這裡 import。
  const names = modules ?? listMockNames()
  const loaded = await loadSelectedMocks(names)
  mountMocks(app, loaded, { defaultApiDomain })

  // WS mock 也是動態載入（選到的），在 listen 前先備好，等等交給 attachWsRouter
  const wsNames = wsModules ?? listWsMockNames()
  const wsMocks = await loadWsMocks(wsNames)

  // ─── Catch-all proxy ──────────────────────────────────────
  // 任何沒被上面 mock 命中的 request 都 forward 到 default-api-domain
  app.use(
    createProxyMiddleware({
      target: defaultApiDomain,
      changeOrigin: true,
      secure: false, // 允許 self-signed cert
      logger: {
        info: () => {}, // 把 info-level 噪音壓下去
        warn: console.warn,
        error: console.error,
      },
      on: {
        // 有些 brand 的 API gateway（例如 btse 的 api.btse.co）只要看到 Origin 標頭就當跨域
        // 瀏覽器請求擋掉（回 400 Invalid request header / 403 Invalid CORS request）。
        // proxy 是 server-to-server，把 Origin 拿掉就會被當同源放行；對寬鬆的 brand 也無害。
        // 瀏覽器端的 CORS 由這台 mock server 自己的 cors() 中介層負責，不受影響。
        proxyReq: (proxyReq) => {
          proxyReq.removeHeader('origin')
        },
        // 上面的 finish listener 已經包辦正常成功/失敗的 log，
        // 這裡只多印「真的連不到後端」的錯誤（finish 不會 fire）
        // 不管 showBypass，這種錯誤一律印
        error: (err, req) => {
          console.error(
            `${dim(ts())} ${red('✗')}  ${pad(req.method, 6)} ${req.originalUrl}  ${red('proxy error: ' + err.message)}`
          )
        },
      },
    })
  )

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`\n🚀 Mock server listening on http://localhost:${port}`)
      console.log(`📡 Proxying unmocked requests to: ${defaultApiDomain}`)
      console.log(`🧩 已載入 HTTP mock: ${loaded.length ? loaded.map((m) => m.name).join(', ') : '（無，全部走 proxy）'}`)
      console.log(`🔌 已載入 WS mock: ${wsMocks.length ? wsMocks.map((m) => m.path).join(', ') : '（無）'}`)
      console.log(
        wsDomain ?
        `🔌 WS: mock 命中本地處理, 其餘 upgrade proxy 到 ${wsDomain}\n` :
        `🔌 WS: 未啟用轉發 (mode 'mock' 的 ws mock 仍可用, tamper/proxy 停用)\n`
      )
      resolve(server)
    })
    attachWsRouter(server, {
      wsDomain,
      wsMocks
    })
  })
}