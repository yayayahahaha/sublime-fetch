#!/usr/bin/env node
import { createClient, scanKeys, readKey } from '../lib/ops.js'
import { printKey } from '../lib/format.js'

const PATTERN = process.argv[2] || 'OTP_MAIL*'
const LIMIT = Number(process.argv[3] || 100)

const client = await createClient()
client.on('error', (err) => console.error('[redis error]', err.message))

console.log(`pattern: ${PATTERN}  (limit ${LIMIT})\n`)

const keys = await scanKeys(client, { pattern: PATTERN, limit: LIMIT })
console.log(`matched ${keys.length} keys (capped at ${LIMIT}):\n`)

for (const key of keys) {
  printKey(await readKey(client, key))
  console.log()
}

await client.quit()
