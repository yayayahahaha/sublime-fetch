#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import select from '@inquirer/select'
import { input, confirm } from '@inquirer/prompts'
import { loadConfig } from './lib/config.js'
import { runPreflight } from './lib/preflight.js'
import { fetchTargetTickets, searchAssignee } from './lib/tickets.js'
import { computeFullAnalysis, buildReportModel } from './lib/report.js'
import { parseFixVersionWindow, describeWindow } from './lib/fixVersion.js'
import { renderTickets, renderReport, renderPreflight, renderRules, setHyperlinks } from './lib/render.js'
import { lightRed, yellow, lightCyan, green, blue } from '../color.js'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))

// 把這次 Jira/GitLab 的原始 fetch data 存成 log（除錯用）
function writeDebugLog(debug) {
  try {
    const dir = path.join(MODULE_DIR, 'logs')
    fs.mkdirSync(dir, { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const file = path.join(dir, `fetch-data-${ts}.json`)
    fs.writeFileSync(file, JSON.stringify(debug, null, 2), 'utf8')
    console.log(green(`📝 fetch data log 已存到：${file}`))
  } catch (err) {
    console.error(lightRed(`❌ 寫入 log 失敗：${err.message}`))
  }
}

const HELP = `
release-check — 依 Jira fix version 檢查各 repo 的 branch / 合併 / MR 狀態

用法：
  node release-check/index.js                    互動式選單（彩色輸出）
  node release-check/index.js --preflight         前置檢查（Jira/GitLab 認證、本地 repo 涵蓋）
  node release-check/index.js --tickets            只撈 ticket
  node release-check/index.js --full               撈 ticket + 分支分析 + GitLab MR

非互動旗標（CLI 預設輸出 JSON，加 --pretty 才彩色）：
  --days <win>       時間窗：往後天數（如 30，只往後）或日期區間（如 20260101-20260110）
                     （未給時預設 前 config.fixVersionMatch.daysBehind ~ 後 daysAhead 天）
  --assignee <name>  指派人（名字或 email，預設取 config.defaultAssignee；需唯一命中）
  --no-fetch         分析前不執行 git fetch
  --pretty           彩色表格輸出（否則輸出 JSON）
  --no-link          關閉 OSC 8 超連結（終端機不支援時改印純文字+URL）
  --help, -h         顯示說明

設定檔（放在 release-check/ 底下）：
  release-check.config.json   非機密設定（複製自 .default）
  secrets.json                機密設定，已被 gitignore（複製自 .default）
`

const ACTION_PREFLIGHT = 'PREFLIGHT'
const ACTION_FETCH_TICKETS = 'FETCH_TICKETS'
const ACTION_ANALYZE = 'ANALYZE'
const ACTION_FULL = 'FULL'

// 讓使用者互動覆寫時間窗，分兩題問：
//   Q1：往後天數（如 30）或日期區間（如 20260101-20260110），預設往後 fallbackDays 天。
//   Q2：只有 Q1 回「數字」時才問「往前幾天」（預設取 config.daysBehind）；Q1 回「區間」則起訖已定、跳過 Q2。
// 格式不符時 inquirer 會用 validate 的錯誤字串就地要求重新輸入。
// 回傳正規化後的 window 物件，或 null（使用者取消）。
async function askWindow(config) {
  const fallbackDays = config.fixVersionMatch?.daysAhead ?? 30
  const fallbackDaysBehind = config.fixVersionMatch?.daysBehind ?? 0

  // Q1：往後天數 或 日期區間
  const q1 = await input({
    message: '時間窗：往後天數（如 30）或日期區間（如 20260101-20260110）？',
    default: String(fallbackDays),
    validate: (v) => {
      const s = String(v ?? '').trim()
      if (s === '') return '請輸入天數（如 30）或日期區間（如 20260101-20260110）'
      const r = parseFixVersionWindow(s, { fallbackDays })
      return r.ok || r.error
    },
  }).catch(() => null)
  if (q1 == null) return null

  const window = parseFixVersionWindow(q1, { fallbackDays }).window
  // Q1 回日期區間 → 起訖已定，不用問往前幾天
  if (window.kind === 'range') return window

  // Q1 回數字 → Q2：往前幾天（預設取 config.fixVersionMatch.daysBehind，沒設則 0）
  const behindRaw = await input({
    message: '往前幾天？（0 = 只看今天以後）',
    default: String(fallbackDaysBehind),
    validate: (v) => /^\d+$/.test(String(v ?? '').trim()) || '請輸入 0 或正整數',
  }).catch(() => null)
  if (behindRaw == null) return null

  return { ...window, daysBehind: Number(String(behindRaw).trim()) }
}

function formatUser(u) {
  const email = u.emailAddress ? ` <${u.emailAddress}>` : ''
  const inactive = u.active === false ? ' (停用)' : ''
  return `${u.displayName}${email}${inactive}`
}

/**
 * 依輸入的名字/email 驗證 assignee 是否存在並解析成 accountId。
 * 回傳：{ skip: true }（不加條件）｜{ accountId, displayName }｜null（查無此人或取消 → 中止）。
 */
async function resolveAssigneeInteractive(config, rawInput) {
  const query = (rawInput ?? '').trim()
  if (!query) return { skip: true }

  console.log(blue('🔍 驗證 assignee（查詢 Jira 使用者）…'))
  let users
  try {
    users = await searchAssignee(config, query)
  } catch (err) {
    console.error(lightRed(`❌ 驗證 assignee 失敗：${err.message}`))
    return null
  }

  if (!users || users.length === 0) {
    console.log(lightRed(`❌ 找不到符合「${query}」的 Jira 使用者，請確認名字或 email 是否正確。`))
    return null
  }

  if (users.length === 1) {
    const u = users[0]
    console.log(green(`✓ 已驗證 assignee：${formatUser(u)}`))
    return { accountId: u.accountId, displayName: u.displayName }
  }

  const picked = await select({
    message: `符合「${query}」的有多位，請選擇 assignee：`,
    choices: users.map((u) => ({ name: formatUser(u), value: u.accountId })),
    loop: false,
    pageSize: 15,
  }).catch(() => null)
  if (picked == null) return null
  const u = users.find((x) => x.accountId === picked)
  return { accountId: picked, displayName: u?.displayName }
}

/**
 * 互動詢問 assignee 並驗證（會打 Jira API）。
 * 回傳 { assigneeAccountId, assigneeDisplayName } ｜ null（取消 / 驗證失敗）。
 */
async function askAssignee(config) {
  const assigneeInput = await input({
    message: `指派人 assignee（名字或 email；Enter 用預設${config.defaultAssignee ? ` ${config.defaultAssignee}` : '「不限」'}，清空則不限）`,
    default: config.defaultAssignee ?? '',
  }).catch(() => null)
  if (assigneeInput == null) return null

  const resolved = await resolveAssigneeInteractive(config, assigneeInput)
  if (resolved == null) return null // 查無此人或取消 → 中止

  return {
    assigneeAccountId: resolved.skip ? null : resolved.accountId,
    assigneeDisplayName: resolved.skip ? null : resolved.displayName,
  }
}

/**
 * 互動詢問時間窗 + assignee 並驗證（供「只撈 ticket」使用）。
 * 回傳 { window, assigneeAccountId, assigneeDisplayName } ｜ null。
 */
async function promptTicketParams(config) {
  const window = await askWindow(config)
  if (window == null) return null
  const assignee = await askAssignee(config)
  if (assignee == null) return null
  return { window, ...assignee }
}

function shortRepoName(required) {
  return String(required).replace(/\.git$/i, '').replace(/\/+$/, '').split('/').pop()
}

// 打 API 各階段的進度提示（避免畫面看起來卡住）。
// MR 階段逐 branch 印起訖 + 耗時：卡住時最後一筆只有「→」沒有「✓」的就是元兇。
function logProgress(phase, detail = {}) {
  if (phase === 'mr-start') {
    console.log(lightCyan(`   共 ${detail.total} 個 branch 要查（${detail.tickets} 張單）`))
    return
  }
  if (phase === 'mr-item-start') {
    console.log(lightCyan(`   → (${detail.n}/${detail.total}) ${shortRepoName(detail.repo)}  ${detail.branch}`))
    return
  }
  if (phase === 'mr-item-done') {
    if (detail.error) {
      console.log(lightRed(`     ✗ (${detail.done}/${detail.total}) ${detail.branch} — ${detail.error} (${detail.ms}ms)`))
    } else {
      const slow = detail.ms >= 3000 ? `${detail.ms}ms ⏱慢` : `${detail.ms}ms`
      console.log(green(`     ✓ (${detail.done}/${detail.total}) ${detail.branch} → ${detail.mrCount} MR (${slow})`))
    }
    return
  }
  const msg = {
    tickets: '📥 從 Jira 撈取符合的 ticket…',
    branches: '🌿 分析各 repo 分支狀態…',
    mr: '🔗 查詢 GitLab MR…',
    'mr-extra': '🔎 補查已 merged 的 MR（短路完成的單）…',
  }[phase]
  if (msg) console.log(blue(msg))
}

// meta：組出 model 需要的展示用中繼資料 + 判定用參數
function buildMeta(config, window, assigneeDisplayName) {
  return {
    daysAhead: window?.kind === 'days' ? window.daysAhead : null,
    daysBehind: window?.kind === 'days' ? (window.daysBehind ?? 0) : null,
    windowLabel: describeWindow(window),
    assignee: assigneeDisplayName ?? null,
    generatedAt: new Date().toISOString(),
    today: new Date(),
    doneStatuses: config.doneStatuses ?? [],
    sentToTestStatuses: config.sentToTestStatuses ?? [],
    urgentWithinDays: config.urgentWithinDays ?? 3,
    dateTokenRegex: config.fixVersionMatch?.dateTokenRegex ?? null,
    jiraBaseUrl: config.jira?.baseUrl ?? null,
    statusEmoji: config.statusEmoji ?? {},
  }
}

/**
 * 互動流程：問參數 → 問是否 fetch → 運算 → 產 model → 彩色報表。
 */
async function runAnalysis(config, { withMr }) {
  // 流程開始前先印出判定規則，方便確認 config
  renderRules(config)

  // 先把不打 API 的提問問完（天數、是否 fetch），最後才問會打 Jira API 的 assignee，
  // 避免 API 卡頓夾在兩個提問中間。
  const window = await askWindow(config)
  if (window == null) return

  const doFetch = await confirm({ message: '分析前先對各 repo 執行 git fetch --all --prune？' }).catch(() => null)
  if (doFetch == null) return void console.log(yellow('使用者取消'))

  const wantLog = await confirm({ message: '是否將 Jira 與 GitLab 的 fetch data 存成 log？', default: false }).catch(() => null)
  if (wantLog == null) return void console.log(yellow('使用者取消'))

  const assignee = await askAssignee(config)
  if (assignee == null) return

  const debug = wantLog ? { jira: { versions: {}, jql: null, issues: [] }, repos: {}, mrQueries: [] } : null

  let data
  try {
    data = await computeFullAnalysis(config, {
      window,
      assigneeAccountId: assignee.assigneeAccountId,
      doFetch,
      withMr,
      onProgress: logProgress,
      debug,
    })
  } catch (err) {
    return void console.error(lightRed(`❌ 分析失敗：${err.message}`))
  }

  if (debug) writeDebugLog(debug)

  if (data.ticketsResult.tickets.length > 0 && data.coverage.matched.length === 0) {
    console.log(lightRed('❌ 沒有任何必檢 repo 對應到本地路徑，分支/MR 資訊會缺，請先跑 Preflight 修正。'))
  }

  const model = buildReportModel(data, buildMeta(config, window, assignee.assigneeDisplayName))
  renderReport(model)
}

// 極簡的 CLI 旗標解析：--key value 或 --flag
function parseCliArgs(argv) {
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next != null && !next.startsWith('--')) {
      flags[key] = next
      i++
    } else {
      flags[key] = true
    }
  }
  return flags
}

/**
 * 非互動地驗證 assignee：查無此人或多筆命中都丟錯（CLI 無法互動挑選）。
 * 回傳 { skip: true } ｜ { accountId, displayName }。
 */
async function resolveAssigneeCli(config, rawInput) {
  const query = (rawInput ?? '').trim()
  if (!query) return { skip: true }
  const users = await searchAssignee(config, query)
  if (!users || users.length === 0) throw new Error(`找不到符合「${query}」的 Jira 使用者`)
  if (users.length > 1) throw new Error(`「${query}」符合多位使用者，請給更精確的名字或 email：${users.map(formatUser).join('; ')}`)
  return { accountId: users[0].accountId, displayName: users[0].displayName }
}

// 載入設定，失敗時印出錯誤並回傳 null
function loadConfigOrReport() {
  try {
    return loadConfig()
  } catch (err) {
    console.error(lightRed(`❌ 設定載入失敗：${err.message}`))
    return null
  }
}

/**
 * 互動式入口，供 auto-login/t99.js 這個中繼站呼叫。預設彩色輸出。
 */
export async function releaseCheckHelper() {
  const config = loadConfigOrReport()
  if (config == null) return

  const action = await select({
    message: 'release-check：要做什麼？',
    choices: [
      { name: '完整檢查流程（含 GitLab MR）', value: ACTION_FULL, description: '撈 ticket + 分支分析 + 查 GitLab MR，輸出表格彙整報表' },
      { name: 'Preflight 前置檢查', value: ACTION_PREFLIGHT, description: '檢查 Jira / GitLab 認證與本地 repo 涵蓋' },
      { name: '撈取目標 ticket（Jira）', value: ACTION_FETCH_TICKETS, description: '依 fix version 時間窗撈出 ticket 清單' },
      { name: '分支 / 合併分析', value: ACTION_ANALYZE, description: '撈 ticket 後，檢查各 repo 的 branch 是否存在、合併與未 push 狀態' },
    ],
    loop: false,
  }).catch(() => null)
  if (action == null) return void console.log(yellow('使用者取消'))

  if (action === ACTION_PREFLIGHT) {
    const result = await runPreflight(config)
    renderPreflight(result)
    return
  }

  if (action === ACTION_FETCH_TICKETS) {
    const params = await promptTicketParams(config)
    if (params == null) return
    try {
      const ticketsResult = await fetchTargetTickets(config, { window: params.window, assigneeAccountId: params.assigneeAccountId })
      const model = buildReportModel(
        { ticketsResult, coverage: { missing: [] }, analysis: null, stagingBranches: config.stagingBranches, doneBranches: config.doneBranches },
        buildMeta(config, params.window, params.assigneeDisplayName)
      )
      renderTickets(model)
    } catch (err) {
      console.error(lightRed(`❌ 撈取 ticket 失敗：${err.message}`))
    }
    return
  }

  if (action === ACTION_ANALYZE) {
    await runAnalysis(config, { withMr: false })
    return
  }

  if (action === ACTION_FULL) {
    await runAnalysis(config, { withMr: true })
    return
  }
}

// CLI 入口（node release-check/index.js ...）。預設輸出 JSON，加 --pretty 才彩色。
async function main() {
  const argv = process.argv.slice(2)

  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP)
    return
  }

  const flags = parseCliArgs(argv)
  const wantPretty = !!flags.pretty
  if (flags['no-link']) setHyperlinks(false) // 終端機不支援 OSC 8 / CI → 退回純文字+URL

  if (flags.preflight) {
    const config = loadConfigOrReport()
    if (config == null) process.exit(1)
    const result = await runPreflight(config)
    if (wantPretty) renderPreflight(result)
    else console.log(JSON.stringify(result, null, 2))
    process.exit(result.ok ? 0 : 1)
  }

  if (flags.full || flags.tickets) {
    const config = loadConfigOrReport()
    if (config == null) process.exit(1)

    const fallbackDays = config.fixVersionMatch?.daysAhead ?? 30
    const fallbackDaysBehind = config.fixVersionMatch?.daysBehind ?? 0
    const rawDays = flags.days != null && flags.days !== true ? flags.days : ''
    const parsedWindow = parseFixVersionWindow(rawDays, { fallbackDays, fallbackDaysBehind })
    if (!parsedWindow.ok) {
      console.error(lightRed(`❌ --days ${parsedWindow.error}`))
      process.exit(1)
    }
    const window = parsedWindow.window

    let resolved
    try {
      const rawAssignee = flags.assignee === true ? '' : flags.assignee ?? config.defaultAssignee
      resolved = await resolveAssigneeCli(config, rawAssignee)
    } catch (err) {
      console.error(lightRed(`❌ ${err.message}`))
      process.exit(1)
    }
    const assigneeAccountId = resolved.skip ? null : resolved.accountId
    const meta = buildMeta(config, window, resolved.skip ? null : resolved.displayName)

    // --tickets（且沒帶 --full）：只撈 ticket
    if (flags.tickets && !flags.full) {
      let ticketsResult
      try {
        ticketsResult = await fetchTargetTickets(config, { window, assigneeAccountId })
      } catch (err) {
        console.error(lightRed(`❌ 撈取 ticket 失敗：${err.message}`))
        process.exit(1)
      }
      const model = buildReportModel(
        { ticketsResult, coverage: { missing: [] }, analysis: null, stagingBranches: config.stagingBranches, doneBranches: config.doneBranches },
        meta
      )
      if (wantPretty) renderTickets(model)
      else console.log(JSON.stringify(model, null, 2))
      return
    }

    // --full：撈 ticket + 分支分析 + MR
    if (wantPretty) renderRules(config)
    let data
    try {
      data = await computeFullAnalysis(config, { window, assigneeAccountId, doFetch: !flags['no-fetch'], withMr: true })
    } catch (err) {
      console.error(lightRed(`❌ 分析失敗：${err.message}`))
      process.exit(1)
    }

    const model = buildReportModel(data, meta)
    if (wantPretty) renderReport(model)
    else console.log(JSON.stringify(model, null, 2))
    return
  }

  // 沒帶旗標 → 進互動式選單
  console.log(lightCyan('\n=== release-check ===\n'))
  await releaseCheckHelper()
}

// 只有「直接執行本檔」時才跑 CLI；被其他模組 import 時不自動執行。
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  main().catch((err) => {
    console.error(lightRed(`❌ 發生未預期的錯誤：${err.stack || err.message}`))
    process.exit(1)
  })
}
