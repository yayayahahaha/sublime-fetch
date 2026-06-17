import { lightCyan, magenta, green, red, yellow } from '../../color.js'

// color.js 沒提供 gray/dim/bold，這邊內部補一下
const RESET = '\x1b[0m'
export const gray = (s) => `\x1b[90m${s}${RESET}`
export const dim = (s) => `\x1b[2m${s}${RESET}`
export const bold = (s) => `\x1b[1m${s}${RESET}`

export function preview(v, n = 200) {
  if (v == null) return gray('(nil)')
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > n ? `${s.slice(0, n)}${dim(`…(${s.length} chars)`)}` : s
}

export function ttlLabel(ttl) {
  if (ttl === -1) return green('no expiry')
  if (ttl === -2) return red('missing')
  return yellow(`ttl=${ttl}s`)
}

// lightCyan 在 color.js 裡已經是 bold + cyan，直接用即可
export function printKey({ key, type, ttl, value }) {
  if (type === 'none') {
    console.log(`${lightCyan(key)}  ${red('(missing)')}`)
    return
  }
  console.log(`${lightCyan(key)}  ${gray(`[${type}]`)}  ${ttlLabel(ttl)}`)
  switch (type) {
    case 'string':
      console.log(`  ${preview(value)}`)
      break
    case 'list':
      console.log(`  ${gray(`len=${value.length}`)}`)
      value.forEach((v, i) => console.log(`  ${gray(`[${i}]`)} ${preview(v)}`))
      break
    case 'hash':
      for (const [f, v] of Object.entries(value)) {
        console.log(`  ${magenta(f)}: ${preview(v)}`)
      }
      break
    case 'set':
      console.log(`  ${preview(JSON.stringify(value))}`)
      break
    case 'zset':
      for (const { member, score } of value) {
        console.log(`  ${yellow(String(score).padStart(15))}  ${preview(member)}`)
      }
      break
    case 'stream':
      console.log(`  ${gray(`len=${value.len}`)}`)
      break
    default:
      console.log(`  ${gray(`(type=${type})`)}`)
  }
}

export function printPrefixTable(title, countMap, total, minCount = 1) {
  console.log(bold(title))
  const sorted = [...countMap.entries()]
    .filter(([, v]) => v >= minCount)
    .sort((a, b) => b[1] - a[1])
  const sum = sorted.reduce((s, [, v]) => s + v, 0)
  for (const [k, v] of sorted) {
    const pct = ((v / total) * 100).toFixed(1).padStart(5)
    console.log(`  ${yellow(String(v).padStart(6))}  ${gray(`${pct}%`)}  ${lightCyan(k)}`)
  }
  console.log(`  ${gray('─'.repeat(40))}`)
  console.log(`  ${String(sum).padStart(6)}  ${gray(`total (${sorted.length} groups)`)}\n`)
}
