#!/usr/bin/env node
import { DEFAULT_REDIS_URL, createClient, countByPrefix, getDbSize } from '../lib/ops.js'
import { printPrefixTable } from '../lib/format.js'

const MIN_COUNT_DEPTH3 = 2

const client = await createClient()
client.on('error', (err) => console.error('[redis error]', err.message))

const total = await getDbSize(client)
const mode = client.isCluster
  ? `cluster, ${client.scanNodes.length} masters`
  : 'standalone'
console.log(`scanning ${DEFAULT_REDIS_URL} (${mode}, dbsize=${total})\n`)

const { scanned, byDepth } = await countByPrefix(client, {
  depths: [1, 2, 3],
  onProgress: (n) => process.stderr.write(`\r  scanned ${n} keys`),
})
process.stderr.write('\n\n')

const [d1, d2, d3] = byDepth
printPrefixTable('=== by first segment ===', d1.map, scanned)
printPrefixTable('=== by first 2 segments ===', d2.map, scanned)
printPrefixTable(
  `=== by first 3 segments (count >= ${MIN_COUNT_DEPTH3}) ===`,
  d3.map,
  scanned,
  MIN_COUNT_DEPTH3
)

await client.quit()
