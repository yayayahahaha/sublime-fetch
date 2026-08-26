#!/usr/bin/env node
// Detached 背景 watcher：輪詢一條 pipeline「連同它的 downstream 子 pipeline」到全部結束，才發桌面通知。
// 由 lib/watchers.js 的 spawnPipelineWatcher 以 detached 方式啟動。
// argv: <projectPath> <pipelineId> <url> <label>
//
// 為什麼要追 downstream：parent 的 trigger job 只要把 child pipeline 建出來就算 success
// （除非 CI 有 strategy: depend），此時 parent 已 success 但 child 還在跑。只看 parent 會太早通知。
import { loadConfig } from './lib/config.js'
import { GitlabClient } from './lib/gitlab.js'
import { getPipeline, getPipelineBridges } from './lib/pipelineActions.js'
import { notifyDesktop } from './lib/notify.js'
import { writeRegistry } from './lib/watchers.js'

const [projectPath, pipelineIdArg, url = '', label = ''] = process.argv.slice(2)
const pipelineId = Number(pipelineIdArg)
const pid = process.pid
const INTERVAL_MS = 20000
const TIMEOUT_MS = 60 * 60 * 1000 // 1 小時上限
const TERMINAL = new Set(['success', 'failed', 'canceled', 'skipped'])
const name = label || `${projectPath} #${pipelineId}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const base = { pid, label, projectPath, pipelineId, url, startedAt: new Date().toISOString() }
const record = (extra) => writeRegistry(pid, { ...base, ...extra, updatedAt: new Date().toISOString() })

// 聚合整棵樹的狀態：任一 failed → failed；任一 canceled → canceled；還有非 terminal → running；
// 其餘（全部 success/skipped）→ success。
function aggregate(entries) {
  const statuses = entries.map((e) => e.status)
  if (statuses.some((s) => s === 'failed' || s === 'query-error')) return 'failed'
  if (statuses.some((s) => s === 'canceled')) return 'canceled'
  if (statuses.some((s) => !TERMINAL.has(s))) return 'running'
  return 'success'
}

async function main() {
  let config
  try {
    config = loadConfig()
  } catch (err) {
    record({ status: 'error', error: `設定載入失敗：${err.message}`, finishedAt: new Date().toISOString() })
    return
  }
  const gitlab = new GitlabClient(config.gitlab)
  const start = Date.now()

  // tracked：key -> { ref, id, status, webUrl }。ref = 專案 path 或 downstream 的數字 project id。
  const tracked = new Map()
  tracked.set(`${projectPath}#${pipelineId}`, { ref: projectPath, id: pipelineId, status: 'created', webUrl: url })

  for (;;) {
    for (const entry of [...tracked.values()]) {
      const r = await getPipeline(gitlab, { projectPath: entry.ref, pipelineId: entry.id })
      entry.status = r.ok ? r.status : 'query-error'
      if (r.ok && !entry.webUrl) entry.webUrl = r.webUrl

      // 不論 parent 是否已 terminal，都撈 bridges 把新出現的 downstream 納入追蹤
      const br = await getPipelineBridges(gitlab, { projectPath: entry.ref, pipelineId: entry.id })
      if (br.ok) {
        for (const d of br.downstreams) {
          const key = `${d.projectId}#${d.id}`
          if (!tracked.has(key)) tracked.set(key, { ref: String(d.projectId), id: d.id, status: d.status, webUrl: d.webUrl })
        }
      }
    }

    const entries = [...tracked.values()]
    const overall = aggregate(entries)
    record({ status: overall, pipelineCount: entries.length, pipelines: entries.map((e) => ({ id: e.id, status: e.status, webUrl: e.webUrl })) })

    if (overall !== 'running') {
      const extra = entries.length > 1 ? `（含 ${entries.length - 1} 條 downstream）` : ''
      // title 帶上 name（brand），避免 macOS 對「相同 title」的通知做去重/取代橫幅
      // failed 用更顯眼的 emoji + 警示音效（Basso），避免跟 success 一樣容易被忽略
      if (overall === 'failed') {
        await notifyDesktop(`🚨🔥 ${name} 失敗！🔥🚨`, `❌❌ pipeline failed${extra} ❌❌`, { sound: 'Basso' })
      } else {
        const emoji = overall === 'success' ? '✅' : '⚠️'
        await notifyDesktop(`${name} ${emoji}`, `pipeline ${overall}${extra}`, { sound: 'Ping' })
      }
      record({ status: overall, pipelineCount: entries.length, pipelines: entries.map((e) => ({ id: e.id, status: e.status, webUrl: e.webUrl })), finishedAt: new Date().toISOString() })
      return
    }
    if (Date.now() - start > TIMEOUT_MS) {
      await notifyDesktop(`${name} ⏱ 逾時`, '監看超過 1 小時，停止監看（pipeline 仍在跑）', { sound: 'Ping' })
      record({ status: 'watch-timeout', pipelineCount: entries.length, finishedAt: new Date().toISOString() })
      return
    }
    await sleep(INTERVAL_MS)
  }
}

main().catch((err) => {
  record({ status: 'error', error: err?.message ?? String(err), finishedAt: new Date().toISOString() })
})
