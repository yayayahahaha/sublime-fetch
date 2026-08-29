import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

const CACHE_DIR = path.resolve(dirname, '../cache')

// namespace → cache 檔。'api' 沿用舊檔名，既有的歷史紀錄不會丟
const CACHE_PATHS = {
  api: path.resolve(CACHE_DIR, 'mock-server-domain-history.json'),
  ws: path.resolve(CACHE_DIR, 'mock-server-ws-domain-history.json'),
}

const MAX_HISTORY = 5

function cachePathOf(namespace) {
  const cachePath = CACHE_PATHS[namespace]
  if (!cachePath) throw new Error(`未知的 domain-history namespace: ${namespace}`)
  return cachePath
}

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true })
}

// 回傳 most-recent-first 的 domain 陣列 (最多 MAX_HISTORY 個)
export function readDomainHistory(namespace = 'api') {
  const cachePath = cachePathOf(namespace)
  ensureCacheDir()
  if (!fs.existsSync(cachePath)) return []
  try {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
    if (!Array.isArray(data)) return []
    return data.filter((d) => typeof d === 'string' && d.trim()).slice(0, MAX_HISTORY)
  } catch {
    return []
  }
}

// 把 domain 放到第一個, 去重, 最多保留 MAX_HISTORY 個
export function saveDomainHistory(domain, namespace = 'api') {
  const v = (domain || '').trim()
  if (!v) return
  const cachePath = cachePathOf(namespace)
  const prev = readDomainHistory(namespace)
  const next = [v, ...prev.filter((d) => d !== v)].slice(0, MAX_HISTORY)
  ensureCacheDir()
  fs.writeFileSync(cachePath, JSON.stringify(next, null, 2), 'utf8')
}
