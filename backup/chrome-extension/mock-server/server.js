import express from 'express'
import cors from 'cors'
import { createProxyMiddleware } from 'http-proxy-middleware'

import registerAssessmentTest from './mocks/assessment-test.js'

// ─── Logging helpers ──────────────────────────────────────
const ts = () => new Date().toTimeString().slice(0, 8) // HH:MM:SS
const pad = (str, n) => String(str).padEnd(n, ' ')

// ANSI colors — 自動偵測 TTY，pipe 到 file 時自動退化成純文字
const useColors = process.stdout.isTTY
const wrap = (code) => (s) => (useColors ? `\x1b[${code}m${s}\x1b[0m` : `${s}`)
const dim = wrap('2')
const red = wrap('31')
const green = wrap('32')
const cyan = wrap('36')

/**
 * 啟動 mock server。
 * @param {object} options
 * @param {string} options.defaultApiDomain  - 真實後端 URL，沒被 mock 的 request 都會 proxy 過去
 * @param {number} [options.port=3000]       - 監聽的 port
 * @param {boolean} [options.showBypass=false] - 是否印 proxy (非 mock) 的 log
 * @returns {Promise<import('http').Server>}
 */
export function startServer({ defaultApiDomain, port = 3000, showBypass = false }) {
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
      const sourceLabel = isMock
        ? green(`[mock:${res.locals._mockLabel}]`)
        : cyan(`[proxy → ${defaultApiDomain}]`)
      const statusLabel =
        res.statusCode >= 400
          ? red(`status=${res.statusCode}`)
          : green(`status=${res.statusCode}`)

      console.log(`${dim(incomingTs)} ${dim('→')}  ${pad(req.method, 6)} ${req.originalUrl}`)
      console.log(
        `${dim(ts())} ${dim('←')}  ${pad(req.method, 6)} ${pad(req.originalUrl, 56)} ${sourceLabel} ${statusLabel} ${dim(elapsed + 'ms')}`
      )
    })

    next()
  })

  // ─── Mock routes ──────────────────────────────────────────
  // 每個 domain 自己一個檔，export default function (app) {...}
  // 想加新 domain：建 mocks/xxx.js → 在這邊 import 然後 register
  registerAssessmentTest(app)

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
      console.log(`📡 Proxying unmocked requests to: ${defaultApiDomain}\n`)
      resolve(server)
    })
  })
}
