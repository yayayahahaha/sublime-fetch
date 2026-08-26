#!/usr/bin/env node
// 一行指令跑完抓圖, 不會問任何問題。互動式版本在 pull-from-figma.js。
//
//   node figma/cli.js --url <figma 網址> --out ./figma-images --token-file ./figma-token.json --clear

import fs from 'fs'
import path from 'path'

import { STATUS, fetchFigmaAssets } from './fetch-assets.js'
import { formatFetchResult, formatSummary } from './report.js'

const TOKEN_KEY = 'token'

const USAGE = `
用法:
  node figma/cli.js --url <figmaUrl> --out <outputDir> --token-file <path> [options]

必填:
  --url <figmaUrl>      Figma 檔案網址, 也接受直接給 file key
  --out <dir>           輸出目錄
  --token-file <path>   JSON 檔, 裡面要有 "${TOKEN_KEY}" 這個 key。
                        token 的 scope 需要 file_content:read。
                        用檔案而不是 --token 是為了不讓 token 進 shell history / ps 的輸出

選項:
  --clear               寫入前清空 output-dir (預設不清空)
  --dry-run             只做定位和檢查, 不出圖也不寫檔 (不會下載任何圖片, 很便宜)
  --verbose             印進行到哪的步驟 log
  --json                只輸出結果物件的 JSON, 不印給人看的報告
  -h, --help            這份說明

token-file 長這樣:
  { "${TOKEN_KEY}": "figd_xxxxxxxx" }

exit code:
  0  全部完成 (--dry-run 時代表檢查沒有 error)
  1  部分完成 (有資產被跳過或有檔案失敗)
  2  沒有完成 (參數錯 / token-file 有問題 / 找不到 page / API 出錯)
`

const FLAGS_WITH_VALUE = ['--url', '--out', '--token-file']
const BOOLEAN_FLAGS = ['--clear', '--json', '--dry-run', '--verbose']

export function parseArgs(argv) {
  const parsed = { _unknown: [] }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === '-h' || arg === '--help') {
      parsed.help = true
      continue
    }
    if (BOOLEAN_FLAGS.includes(arg)) {
      parsed[camel(arg)] = true
      continue
    }
    if (FLAGS_WITH_VALUE.includes(arg)) {
      const value = argv[i + 1]
      if (value == null || value.startsWith('--')) {
        return { error: `${arg} 後面要接值` }
      }
      parsed[camel(arg)] = value
      i += 1
      continue
    }
    parsed._unknown.push(arg)
  }

  if (parsed._unknown.length > 0) {
    return { error: `看不懂的參數: ${parsed._unknown.join(' ')}` }
  }
  return parsed
}

function camel(flag) {
  return flag.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

/**
 * 從 JSON 檔讀 token。錯的方式很多種, 每種都給看得懂的訊息。
 *
 * @returns {string | { error: string }}
 */
export function readTokenFile(tokenFile) {
  if (tokenFile == null) {
    return { error: '缺少 --token-file' }
  }

  const filePath = path.resolve(tokenFile)

  let raw
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') return { error: `--token-file 找不到這個檔案: ${filePath}` }
    if (e.code === 'EISDIR') return { error: `--token-file 是一個資料夾, 需要是 JSON 檔: ${filePath}` }
    if (e.code === 'EACCES') return { error: `--token-file 沒有讀取權限: ${filePath}` }
    return { error: `--token-file 讀取失敗 (${e.code ?? e.message}): ${filePath}` }
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return { error: `--token-file 不是合法的 JSON: ${filePath}\n   ${e.message}` }
  }

  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: `--token-file 的內容需要是一個 JSON object, 像 { "${TOKEN_KEY}": "figd_xxx" }: ${filePath}` }
  }
  if (!(TOKEN_KEY in parsed)) {
    const keys = Object.keys(parsed)
    const found = keys.length === 0 ? '(沒有任何 key)' : keys.join(', ')
    return { error: `--token-file 裡面沒有 "${TOKEN_KEY}" 這個 key。目前有的是: ${found}` }
  }
  if (typeof parsed[TOKEN_KEY] !== 'string' || parsed[TOKEN_KEY].trim() === '') {
    return { error: `--token-file 的 "${TOKEN_KEY}" 需要是非空字串` }
  }

  return parsed[TOKEN_KEY].trim()
}

function exitCodeFor(result) {
  if (result.status === STATUS.SUCCESS) return 0
  if (result.status === STATUS.PARTIAL) return 1
  // dry-run 沒有寫檔, 用檢查有沒有 error 當結果
  if (result.status === STATUS.DRY_RUN) return result.ok ? 0 : 1
  return 2
}

export async function main(argv = process.argv.slice(2), { log = console.log, error = console.error } = {}) {
  const args = parseArgs(argv)

  if (args.help || argv.length === 0) {
    log(USAGE.trim())
    return 0
  }
  if (args.error != null) {
    error(args.error)
    error('用 --help 看說明')
    return 2
  }

  const token = readTokenFile(args.tokenFile)
  if (typeof token !== 'string') {
    error(token.error)
    return 2
  }

  const result = await fetchFigmaAssets({
    figmaUrl: args.url,
    figmaToken: token,
    outputDir: args.out,
    clearOutputDir: args.clear === true,
    dryRun: args.dryRun === true,
    verbose: args.verbose === true,
  })

  if (args.json === true) {
    log(JSON.stringify(result, null, 2))
  } else {
    formatFetchResult(result).forEach((line) => log(line))
    log(formatSummary(result))
  }

  return exitCodeFor(result)
}

// 被當成指令執行時才跑, 被 import 進來測試不會
if (process.argv[1] != null && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  process.exitCode = await main()
}
