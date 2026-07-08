import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

const CACHE_DIR = path.resolve(dirname, '../cache')
const CACHE_PATH = path.resolve(CACHE_DIR, 'mock-server-domain-history.json')

const MAX_HISTORY = 5

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true })
}

// 回傳 most-recent-first 的 domain 陣列 (最多 MAX_HISTORY 個)
export function readDomainHistory() {
  ensureCacheDir()
  if (!fs.existsSync(CACHE_PATH)) return []
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'))
    if (!Array.isArray(data)) return []
    return data.filter((d) => typeof d === 'string' && d.trim()).slice(0, MAX_HISTORY)
  } catch {
    return []
  }
}

// 把 domain 放到第一個, 去重, 最多保留 MAX_HISTORY 個
export function saveDomainHistory(domain) {
  const v = (domain || '').trim()
  if (!v) return
  const prev = readDomainHistory()
  const next = [v, ...prev.filter((d) => d !== v)].slice(0, MAX_HISTORY)
  ensureCacheDir()
  fs.writeFileSync(CACHE_PATH, JSON.stringify(next, null, 2), 'utf8')
}
