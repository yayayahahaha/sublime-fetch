import Redis from 'ioredis'

export const DEFAULT_REDIS_URL = process.env.REDIS_URL || 'redis://10.1.30.185:6379'

function parseUrl(url) {
  const u = new URL(url)
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: u.password || undefined,
  }
}

function parseClusterNodes(text) {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.trim().split(/\s+/)
      const [id, addr, flagsStr] = parts
      const [host, rest] = addr.split(':')
      const port = Number(rest.split('@')[0])
      return { id, host, port, flags: flagsStr.split(',') }
    })
}

export async function createClient(url = DEFAULT_REDIS_URL, options = {}) {
  const { password } = parseUrl(url)
  const baseOpts = { maxRetriesPerRequest: 2, password, ...options }

  const probe = new Redis(url, { ...baseOpts, lazyConnect: false })
  let isCluster = false
  let masters = []
  try {
    const info = await probe.info('cluster')
    isCluster = /cluster_enabled:1/.test(info)
    if (isCluster) {
      const nodes = parseClusterNodes(await probe.cluster('nodes'))
      masters = nodes.filter((n) => n.flags.includes('master'))
    }
  } catch {
    // INFO cluster missing → assume standalone
  }
  await probe.quit().catch(() => {})

  if (!isCluster) {
    const client = new Redis(url, baseOpts)
    client.isCluster = false
    client.scanNodes = [client]
    return client
  }

  // Single-key ops go through Redis.Cluster (handles MOVED routing).
  // For SCAN / DBSIZE we want a stable list of master connections we
  // control ourselves, since `cluster.nodes('master')` is lazy.
  const seedEndpoints = masters.map((m) => ({ host: m.host, port: m.port }))
  const cluster = new Redis.Cluster(seedEndpoints, {
    redisOptions: baseOpts,
    scaleReads: 'master',
  })
  await new Promise((resolve, reject) => {
    cluster.once('ready', resolve)
    cluster.once('error', reject)
  })

  const directMasters = masters.map(
    (m) => new Redis({ host: m.host, port: m.port, ...baseOpts })
  )
  cluster.isCluster = true
  cluster.scanNodes = directMasters

  const origQuit = cluster.quit.bind(cluster)
  cluster.quit = async () => {
    await Promise.all([
      origQuit().catch(() => {}),
      ...directMasters.map((c) => c.quit().catch(() => {})),
    ])
  }

  return cluster
}

export function getMasterNodes(client) {
  return client.scanNodes || [client]
}

export function isPattern(s) {
  return typeof s === 'string' && /[*?[\]]/.test(s)
}

async function scanOneNode(node, { pattern, count, limit }) {
  const keys = []
  let cursor = '0'
  do {
    const [next, batch] = await node.scan(cursor, 'MATCH', pattern, 'COUNT', count)
    cursor = next
    for (const k of batch) {
      keys.push(k)
      if (keys.length >= limit) return keys
    }
  } while (cursor !== '0')
  return keys
}

export async function* scanIterator(client, { pattern = '*', count = 500 } = {}) {
  for (const node of getMasterNodes(client)) {
    let cursor = '0'
    do {
      const [next, batch] = await node.scan(cursor, 'MATCH', pattern, 'COUNT', count)
      cursor = next
      for (const key of batch) yield key
    } while (cursor !== '0')
  }
}

export async function scanKeys(client, { pattern = '*', count = 500, limit = Infinity } = {}) {
  const nodes = getMasterNodes(client)
  const perNodeLimit = Number.isFinite(limit) ? limit : Infinity
  const arrays = await Promise.all(
    nodes.map((node) => scanOneNode(node, { pattern, count, limit: perNodeLimit }))
  )
  const all = arrays.flat()
  return Number.isFinite(limit) ? all.slice(0, limit) : all
}

export async function readKey(client, key) {
  const type = await client.type(key)
  const ttl = await client.ttl(key)
  let value
  switch (type) {
    case 'string':
      value = await client.get(key)
      break
    case 'list':
      value = await client.lrange(key, 0, -1)
      break
    case 'hash':
      value = await client.hgetall(key)
      break
    case 'set':
      value = await client.smembers(key)
      break
    case 'zset': {
      const items = await client.zrange(key, 0, -1, 'WITHSCORES')
      value = []
      for (let i = 0; i < items.length; i += 2) {
        value.push({ member: items[i], score: Number(items[i + 1]) })
      }
      break
    }
    case 'stream':
      value = { len: await client.xlen(key) }
      break
    case 'none':
      value = null
      break
    default:
      value = undefined
  }
  return { key, type, ttl, value }
}

export async function resolveKeys(client, keyOrPattern) {
  if (isPattern(keyOrPattern)) return scanKeys(client, { pattern: keyOrPattern })
  const exists = await client.exists(keyOrPattern)
  return exists ? [keyOrPattern] : []
}

export async function setKey(client, key, value, { ttl } = {}) {
  if (ttl) return client.set(key, value, 'EX', ttl)
  return client.set(key, value)
}

export async function delKeys(client, keys, { chunkSize = 100 } = {}) {
  if (!keys.length) return 0
  if (client.isCluster) {
    let deleted = 0
    for (const k of keys) deleted += await client.del(k)
    return deleted
  }
  let deleted = 0
  for (let i = 0; i < keys.length; i += chunkSize) {
    deleted += await client.del(...keys.slice(i, i + chunkSize))
  }
  return deleted
}

export async function hgetField(client, key, field) {
  return client.hget(key, field)
}

export async function hsetField(client, key, field, value) {
  return client.hset(key, field, value)
}

export async function hdelField(client, key, field) {
  return client.hdel(key, field)
}

export async function getTTL(client, key) {
  return client.ttl(key)
}

export async function setExpire(client, key, seconds) {
  return client.expire(key, seconds)
}

export async function getDbSize(client) {
  const nodes = getMasterNodes(client)
  const sizes = await Promise.all(nodes.map((n) => n.dbsize()))
  return sizes.reduce((a, b) => a + b, 0)
}

export async function getServerVersion(client) {
  const target = getMasterNodes(client)[0]
  const info = await target.info('server')
  const line = info.split('\n').find((l) => l.startsWith('redis_version'))
  return line ? line.split(':')[1].trim() : null
}

export async function getTopology(client) {
  if (!client.isCluster) {
    return { mode: 'standalone', nodes: [{ role: 'master' }] }
  }
  const masters = (client.scanNodes || []).map((n) => ({
    role: 'master',
    host: n.options.host,
    port: n.options.port,
  }))
  return { mode: 'cluster', nodes: masters }
}

export function detectSeparator(key) {
  return key.includes(':') ? ':' : '_'
}

export function keyPrefix(key, depth) {
  const sep = detectSeparator(key)
  return key.split(sep).slice(0, depth).join(sep)
}

export async function countByPrefix(
  client,
  { depths = [1, 2, 3], pattern = '*', count = 1000, onProgress } = {}
) {
  const maps = depths.map(() => new Map())
  let scanned = 0
  const nodes = getMasterNodes(client)

  await Promise.all(
    nodes.map(async (node) => {
      let cursor = '0'
      do {
        const [next, batch] = await node.scan(cursor, 'MATCH', pattern, 'COUNT', count)
        cursor = next
        for (const key of batch) {
          depths.forEach((d, i) => {
            const p = keyPrefix(key, d)
            maps[i].set(p, (maps[i].get(p) || 0) + 1)
          })
          scanned += 1
          if (onProgress && scanned % 1000 === 0) onProgress(scanned)
        }
      } while (cursor !== '0')
    })
  )

  if (onProgress) onProgress(scanned)
  return {
    scanned,
    byDepth: depths.map((depth, i) => ({ depth, map: maps[i] })),
  }
}
