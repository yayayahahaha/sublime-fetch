import select from '@inquirer/select'
import { input } from '@inquirer/prompts'
import { red, green, yellow } from '../color.js'
import {
  createClient,
  scanKeys,
  readKey,
  resolveKeys,
  delKeys,
  countByPrefix,
  getDbSize,
  getServerVersion,
  isPattern,
} from './lib/ops.js'
import { gray, bold, dim, printKey, printPrefixTable } from './lib/format.js'

const DEL_PREVIEW_MAX = 20
const LIST_DEFAULT_LIMIT = 50

const ENVIRONMENTS = {
  dev: { label: 'dev', url: 'redis://10.1.30.185:6379' },
  staging: { label: 'staging', url: 'redis://10.41.242.181:6379' },
}

export async function operateRedis() {
  const envKey = await select({
    message: 'select environment:',
    choices: [
      { name: `1. dev      ${gray(`(${ENVIRONMENTS.dev.url})`)}`, value: 'dev' },
      { name: `2. staging  ${gray(`(${ENVIRONMENTS.staging.url})`)}`, value: 'staging' },
    ],
  }).catch(() => null)
  if (envKey == null) return
  const env = ENVIRONMENTS[envKey]

  const client = await createClient(env.url)
  client.on('error', (err) => console.error(`${red('[redis error]')} ${err.message}`))

  try {
    const version = await getServerVersion(client)
    const size = await getDbSize(client)
    const mode = client.isCluster
      ? `cluster (${client.scanNodes.length} masters)`
      : 'standalone'
    console.log(
      gray(
        `connected to ${bold(env.label)} (${env.url})  redis ${version}  ${mode}  dbsize=${size}`
      )
    )
    console.log()

    while (true) {
      const action = await select({
        message: 'what would you like to do?',
        choices: [
          {
            name: `1. Device OTP  ${gray('(OTP_MAIL__key_* + OTP_MAIL_LOGIN_NEW_DEVICE_*)')}`,
            value: 'device-otp',
          },
          { name: '2. List keys', value: 'list' },
          { name: '3. Prefix stats', value: 'stats' },
          { name: '4. Delete key(s)', value: 'delete' },
          { name: '0. Exit', value: 'exit' },
        ],
      })

      if (action === 'exit') break
      if (action === 'device-otp') await actionDeviceOtp(client)
      if (action === 'list') await actionList(client)
      if (action === 'stats') await actionPrefixStats(client)
      if (action === 'delete') await actionDelete(client)
      console.log()
    }
  } catch (e) {
    if (e.name !== 'ExitPromptError') {
      console.error(`${red('error:')} ${e.message}`)
    }
  } finally {
    await client.quit()
  }
}

async function listKeys(client, pattern, limit) {
  if (!isPattern(pattern)) {
    console.log(`\n${gray('exact key lookup (no scan):')}\n`)
    printKey(await readKey(client, pattern))
    console.log()
    return
  }
  const keys = await scanKeys(client, { pattern, limit })
  console.log(`\n${gray(`pattern ${pattern}  matched ${keys.length} key(s)`)}\n`)
  for (const key of keys) {
    printKey(await readKey(client, key))
    console.log()
  }
}

async function actionList(client) {
  const pattern = await input({
    message: 'pattern (glob, e.g. OTP_MAIL*):',
    default: '*',
  })
  const limitStr = await input({
    message: 'max keys to show:',
    default: String(LIST_DEFAULT_LIMIT),
  })
  const limit = Math.max(1, Number(limitStr) || LIST_DEFAULT_LIMIT)
  await listKeys(client, pattern, limit)
}

const DEVICE_OTP_PATTERNS = ['OTP_MAIL__key_*', 'OTP_MAIL_LOGIN_NEW_DEVICE_*']

async function actionDeviceOtp(client) {
  for (const pattern of DEVICE_OTP_PATTERNS) {
    await listKeys(client, pattern, 100)
  }
}

async function actionPrefixStats(client) {
  const pattern = await input({
    message: 'pattern to scan (default = all keys):',
    default: '*',
  })
  const depthsStr = await input({
    message: 'depths to count (comma-separated):',
    default: '1,2,3',
  })
  const depths = depthsStr
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
  if (!depths.length) {
    console.log(`${yellow('no valid depths, aborted.')}`)
    return
  }

  console.log()
  const { scanned, byDepth } = await countByPrefix(client, {
    pattern,
    depths,
    onProgress: (n) => process.stderr.write(`\r  ${gray(`scanned ${n} keys`)}`),
  })
  process.stderr.write('\n\n')

  if (scanned === 0) {
    console.log(`${yellow(`no keys matched ${pattern}`)}`)
    return
  }

  for (const { depth, map } of byDepth) {
    const minCount = depth >= 3 ? 2 : 1
    const suffix = minCount > 1 ? ` (count >= ${minCount})` : ''
    printPrefixTable(`=== by first ${depth} segment(s)${suffix} ===`, map, scanned, minCount)
  }
}

async function actionDelete(client) {
  const target = await input({ message: 'key or pattern to delete:' })
  if (!target.trim()) {
    console.log(`${gray('empty input, aborted.')}`)
    return
  }
  const keys = await resolveKeys(client, target.trim())
  if (!keys.length) {
    console.log(`${yellow('no keys matched')} ${gray(`(${target})`)}`)
    return
  }

  console.log(
    `\n${red(`⚠  ${keys.length} key(s) will be DELETED`)}  ${gray(`(pattern: ${target})`)}\n`
  )
  const previewN = Math.min(keys.length, DEL_PREVIEW_MAX)
  for (const key of keys.slice(0, previewN)) {
    printKey(await readKey(client, key))
    console.log()
  }
  if (keys.length > previewN) {
    console.log(`${gray(`...and ${keys.length - previewN} more key(s) not shown`)}\n`)
  }

  const answer = await input({
    message: `${red(`type 'yes' to delete ${keys.length} key(s):`)}`,
  })
  if (answer.trim().toLowerCase() !== 'yes') {
    console.log(`${gray('aborted.')}`)
    return
  }
  const deleted = await delKeys(client, keys)
  console.log(`${green(`✓ deleted ${deleted} key(s)`)}`)
}
