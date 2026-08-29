#!/usr/bin/env node
import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { red, green, yellow, magenta, lightCyan } from '../../color.js'
import {
  DEFAULT_REDIS_URL,
  createClient,
  resolveKeys,
  readKey,
  setKey,
  delKeys,
  hgetField,
  hsetField,
  hdelField,
  getTTL,
  setExpire,
} from '../lib/ops.js'
import { gray, dim, bold, preview, ttlLabel, printKey } from '../lib/format.js'

const DEL_PREVIEW_MAX = 20

const usage = `
${bold('usage:')}
  node bin/op.js ${lightCyan('get')}    <key>
  node bin/op.js ${lightCyan('set')}    <key> <value> [--ttl <seconds>]
  node bin/op.js ${lightCyan('del')}    <key-or-pattern>
  node bin/op.js ${lightCyan('hget')}   <key> <field>
  node bin/op.js ${lightCyan('hset')}   <key> <field> <value>
  node bin/op.js ${lightCyan('hdel')}   <key> <field>
  node bin/op.js ${lightCyan('ttl')}    <key>
  node bin/op.js ${lightCyan('expire')} <key> <seconds>

${dim(`env: REDIS_URL (default ${DEFAULT_REDIS_URL})`)}
`

const [cmd, ...rest] = process.argv.slice(2)

if (!cmd || cmd === '-h' || cmd === '--help') {
  console.log(usage)
  process.exit(0)
}

const client = await createClient()
client.on('error', (err) => console.error(`${red('[redis error]')} ${err.message}`))

function parseFlag(args, flag) {
  const i = args.indexOf(flag)
  if (i === -1) return null
  const val = args[i + 1]
  args.splice(i, 2)
  return val
}

async function confirmYes(prompt) {
  const rl = readline.createInterface({ input: stdin, output: stdout })
  const answer = await rl.question(`${prompt} `)
  rl.close()
  return answer.trim().toLowerCase() === 'yes'
}

try {
  switch (cmd) {
    case 'get': {
      const [key] = rest
      if (!key) throw new Error('missing key')
      printKey(await readKey(client, key))
      break
    }

    case 'set': {
      const args = [...rest]
      const ttl = parseFlag(args, '--ttl')
      const [key, value] = args
      if (!key || value === undefined) throw new Error('usage: set <key> <value> [--ttl N]')
      const existed = await client.exists(key)
      if (existed) {
        const prev = await client.get(key)
        console.log(yellow('overwriting existing key'))
        console.log(`  ${gray('prev:')} ${preview(prev)}`)
        console.log(`  ${gray('new: ')} ${preview(value)}`)
      }
      await setKey(client, key, value, { ttl: ttl ? Number(ttl) : undefined })
      console.log(
        `${green('✓ SET')} ${lightCyan(key)}${ttl ? ` ${gray(`(ttl=${ttl}s)`)}` : ''}`
      )
      break
    }

    case 'del': {
      const [pattern] = rest
      if (!pattern) throw new Error('missing key/pattern')
      const keys = await resolveKeys(client, pattern)

      if (keys.length === 0) {
        console.log(`${yellow('no keys matched')} ${gray(`(${pattern})`)}`)
        break
      }

      console.log(
        `${red(`⚠  ${keys.length} key(s) will be DELETED`)}  ${gray(`(pattern: ${pattern})`)}\n`
      )
      const previewN = Math.min(keys.length, DEL_PREVIEW_MAX)
      for (const key of keys.slice(0, previewN)) {
        printKey(await readKey(client, key))
        console.log()
      }
      if (keys.length > previewN) {
        console.log(`${gray(`...and ${keys.length - previewN} more key(s) not shown`)}\n`)
      }

      const ok = await confirmYes(
        `${red(`DELETE ${keys.length} key(s)?`)} ${dim("type 'yes' to confirm:")}`
      )
      if (!ok) {
        console.log(gray('aborted.'))
        break
      }
      const deleted = await delKeys(client, keys)
      console.log(`${green(`✓ deleted ${deleted} key(s)`)}`)
      break
    }

    case 'hget': {
      const [key, field] = rest
      if (!key || !field) throw new Error('usage: hget <key> <field>')
      const v = await hgetField(client, key, field)
      console.log(`${lightCyan(key)}.${magenta(field)} = ${preview(v)}`)
      break
    }

    case 'hset': {
      const [key, field, value] = rest
      if (!key || !field || value === undefined)
        throw new Error('usage: hset <key> <field> <value>')
      const prev = await hgetField(client, key, field)
      if (prev !== null) {
        console.log(yellow('overwriting existing field'))
        console.log(`  ${gray('prev:')} ${preview(prev)}`)
        console.log(`  ${gray('new: ')} ${preview(value)}`)
      }
      await hsetField(client, key, field, value)
      console.log(`${green('✓ HSET')} ${lightCyan(key)}.${magenta(field)}`)
      break
    }

    case 'hdel': {
      const [key, field] = rest
      if (!key || !field) throw new Error('usage: hdel <key> <field>')
      const prev = await hgetField(client, key, field)
      if (prev === null) {
        console.log(yellow('field does not exist'))
        break
      }
      console.log(`${red(`⚠  HDEL`)} ${lightCyan(key)}.${magenta(field)}`)
      console.log(`  ${gray('current:')} ${preview(prev)}`)
      const ok = await confirmYes(
        `${red('delete this field?')} ${dim("type 'yes' to confirm:")}`
      )
      if (!ok) {
        console.log(gray('aborted.'))
        break
      }
      await hdelField(client, key, field)
      console.log(green('✓ HDEL'))
      break
    }

    case 'ttl': {
      const [key] = rest
      if (!key) throw new Error('missing key')
      const ttl = await getTTL(client, key)
      console.log(`${lightCyan(key)}  ${ttlLabel(ttl)}`)
      break
    }

    case 'expire': {
      const [key, seconds] = rest
      if (!key || !seconds) throw new Error('usage: expire <key> <seconds>')
      const ok = await setExpire(client, key, Number(seconds))
      console.log(
        ok ? `${green(`✓ expire set to ${seconds}s`)}` : red('key does not exist')
      )
      break
    }

    default:
      console.log(`${red(`unknown command: ${cmd}`)}`)
      console.log(usage)
      process.exitCode = 1
  }
} catch (e) {
  console.error(`${red('error:')} ${e.message}`)
  process.exitCode = 1
} finally {
  await client.quit()
}
