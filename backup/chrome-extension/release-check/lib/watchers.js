// 背景監看 watcher 的 registry：spawn detached 程序、記錄狀態、列出、kill、清理。
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(LIB_DIR, '..') // release-check/
const REG_DIR = path.join(ROOT, '.watchers')
const WATCHER_ENTRY = path.join(ROOT, 'pipelineWatcher.js')

const TERMINAL = new Set(['success', 'failed', 'canceled', 'skipped'])

function ensureDir() {
  fs.mkdirSync(REG_DIR, { recursive: true })
}

function registryPath(pid) {
  return path.join(REG_DIR, `${pid}.json`)
}

export function writeRegistry(pid, data) {
  ensureDir()
  fs.writeFileSync(registryPath(pid), JSON.stringify(data, null, 2), 'utf8')
}

export function removeRegistry(pid) {
  try {
    fs.unlinkSync(registryPath(pid))
  } catch {
    /* 檔案不在就算了 */
  }
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// 讀出所有 watcher 紀錄（附上 alive 與 terminal 判斷）
export function readAllWatchers() {
  if (!fs.existsSync(REG_DIR)) return []
  const out = []
  for (const file of fs.readdirSync(REG_DIR)) {
    if (!file.endsWith('.json')) continue
    try {
      const data = JSON.parse(fs.readFileSync(path.join(REG_DIR, file), 'utf8'))
      out.push({ ...data, alive: isAlive(data.pid), terminal: TERMINAL.has(data.status) })
    } catch {
      /* 壞檔略過 */
    }
  }
  return out.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)))
}

// kill 一個 watcher（送 SIGTERM）並移除紀錄
export function killWatcher(pid) {
  let killed = true
  try {
    process.kill(pid, 'SIGTERM')
  } catch (err) {
    // ESRCH = 程序已不在，視為已結束
    killed = err?.code === 'ESRCH'
    if (!killed) {
      return { ok: false, error: err.message }
    }
  }
  removeRegistry(pid)
  return { ok: true }
}

// 清掉「已結束（terminal）或程序已死」的紀錄，回清掉幾筆
export function cleanupDead() {
  let n = 0
  for (const w of readAllWatchers()) {
    if (!w.alive || w.terminal) {
      removeRegistry(w.pid)
      n++
    }
  }
  return n
}

/**
 * spawn 一個 detached 背景 watcher 程序（CLI 結束後續跑），並寫初始 registry。
 * 回 { ok:true, pid } | { ok:false, error }
 */
export function spawnPipelineWatcher({ projectPath, pipelineId, url = '', label = '' } = {}) {
  if (!projectPath || pipelineId == null) return { ok: false, error: 'spawnPipelineWatcher 缺少 projectPath / pipelineId' }
  try {
    ensureDir()
    const child = spawn(process.execPath, [WATCHER_ENTRY, projectPath, String(pipelineId), url, label], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    const now = new Date().toISOString()
    writeRegistry(child.pid, {
      pid: child.pid,
      label,
      projectPath,
      pipelineId,
      url,
      status: 'watching',
      startedAt: now,
      updatedAt: now,
    })
    return { ok: true, pid: child.pid }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}
