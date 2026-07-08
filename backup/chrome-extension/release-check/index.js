#!/usr/bin/env node
import path from 'path'
import { fileURLToPath } from 'url'
import select from '@inquirer/select'
import { input, confirm } from '@inquirer/prompts'
import { loadConfig } from './lib/config.js'
import { runPreflight } from './lib/preflight.js'
import { fetchTargetTickets, searchAssignee } from './lib/tickets.js'
import { computeFullAnalysis, buildReportModel } from './lib/report.js'
import { renderTickets, renderReport, renderPreflight } from './lib/render.js'
import { lightRed, yellow, lightCyan, green } from '../color.js'

const HELP = `
release-check — 依 Jira fix version 檢查各 repo 的 branch / 合併 / MR 狀態

用法：
  node release-check/index.js                    互動式選單（彩色輸出）
  node release-check/index.js --preflight         前置檢查（Jira/GitLab 認證、本地 repo 涵蓋）
  node release-check/index.js --tickets            只撈 ticket
  node release-check/index.js --full               撈 ticket + 分支分析 + GitLab MR

非互動旗標（CLI 預設輸出 JSON，加 --pretty 才彩色）：
  --days <n>         往後幾天的 fix version（預設取 config.fixVersionMatch.daysAhead）
  --assignee <name>  指派人（名字或 email，預設取 config.defaultAssignee；需唯一命中）
  --no-fetch         分析前不執行 git fetch
  --pretty           彩色文字輸出（否則輸出 JSON）
  --help, -h         顯示說明

設定檔（放在 release-check/ 底下）：
  release-check.config.json   非機密設定（複製自 .default）
  secrets.json                機密設定，已被 gitignore（複製自 .default）
`

const ACTION_PREFLIGHT = 'PREFLIGHT'
const ACTION_FETCH_TICKETS = 'FETCH_TICKETS'
const ACTION_ANALYZE = 'ANALYZE'
const ACTION_FULL = 'FULL'

// 讓使用者互動覆寫「往後幾天」，Enter 則用 config 預設
async function askDaysAhead(config) {
  const fallback = config.fixVersionMatch?.daysAhead ?? 30
  const answer = await input({
    message: `往後幾天內的 fix version？（Enter 用預設 ${fallback}）`,
    default: String(fallback),
    validate: (v) => v == null || v === '' || /^\d+$/.test(v) || '請輸入正整數天數',
  }).catch(() => null)
  if (answer == null) return null
  return answer === '' ? fallback : Number(answer)
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
 * 互動詢問 daysAhead + assignee 並驗證。
 * 回傳 { daysAhead, assigneeAccountId, assigneeDisplayName } ｜ null（取消 / 驗證失敗）。
 */
async function promptTicketParams(config) {
  const daysAhead = await askDaysAhead(config)
  if (daysAhead == null) return null

  const assigneeInput = await input({
    message: `指派人 assignee（名字或 email；Enter 用預設${config.defaultAssignee ? ` ${config.defaultAssignee}` : '「不限」'}，清空則不限）`,
    default: config.defaultAssignee ?? '',
  }).catch(() => null)
  if (assigneeInput == null) return null

  const resolved = await resolveAssigneeInteractive(config, assigneeInput)
  if (resolved == null) return null // 查無此人或取消 → 中止

  return {
    daysAhead,
    assigneeAccountId: resolved.skip ? null : resolved.accountId,
    assigneeDisplayName: resolved.skip ? null : resolved.displayName,
  }
}

// meta：組出 model 需要的展示用中繼資料 + 判定用參數
function buildMeta(config, daysAhead, assigneeDisplayName) {
  return {
    daysAhead,
    assignee: assigneeDisplayName ?? null,
    generatedAt: new Date().toISOString(),
    today: new Date(),
    notDoneStatuses: config.notDoneStatuses ?? [],
    doneStatuses: config.doneStatuses ?? [],
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
  const params = await promptTicketParams(config)
  if (params == null) return

  const doFetch = await confirm({ message: '分析前先對各 repo 執行 git fetch --all --prune？' }).catch(() => null)
  if (doFetch == null) return void console.log(yellow('使用者取消'))

  let data
  try {
    data = await computeFullAnalysis(config, {
      daysAhead: params.daysAhead,
      assigneeAccountId: params.assigneeAccountId,
      doFetch,
      withMr,
    })
  } catch (err) {
    return void console.error(lightRed(`❌ 分析失敗：${err.message}`))
  }

  if (data.ticketsResult.tickets.length > 0 && data.coverage.matched.length === 0) {
    console.log(lightRed('❌ 沒有任何必檢 repo 對應到本地路徑，分支/MR 資訊會缺，請先跑 Preflight 修正。'))
  }

  const model = buildReportModel(data, buildMeta(config, params.daysAhead, params.assigneeDisplayName))
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
      { name: 'Preflight 前置檢查', value: ACTION_PREFLIGHT, description: '檢查 Jira / GitLab 認證與本地 repo 涵蓋' },
      { name: '撈取目標 ticket（Jira）', value: ACTION_FETCH_TICKETS, description: '依 fix version 時間窗撈出 ticket 清單' },
      { name: '分支 / 合併分析', value: ACTION_ANALYZE, description: '撈 ticket 後，檢查各 repo 的 branch 是否存在、合併與未 push 狀態' },
      { name: '完整檢查流程（含 GitLab MR）', value: ACTION_FULL, description: '撈 ticket + 分支分析 + 查 GitLab MR，輸出彙整報表' },
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
      const ticketsResult = await fetchTargetTickets(config, { daysAhead: params.daysAhead, assigneeAccountId: params.assigneeAccountId })
      const model = buildReportModel(
        { ticketsResult, coverage: { missing: [] }, analysis: null, targetBranches: config.targetBranches },
        buildMeta(config, params.daysAhead, params.assigneeDisplayName)
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

    const daysAhead = flags.days != null && flags.days !== true ? Number(flags.days) : config.fixVersionMatch?.daysAhead ?? 30
    if (!Number.isFinite(daysAhead) || daysAhead < 0) {
      console.error(lightRed('❌ --days 需為非負整數'))
      process.exit(1)
    }

    let resolved
    try {
      const rawAssignee = flags.assignee === true ? '' : flags.assignee ?? config.defaultAssignee
      resolved = await resolveAssigneeCli(config, rawAssignee)
    } catch (err) {
      console.error(lightRed(`❌ ${err.message}`))
      process.exit(1)
    }
    const assigneeAccountId = resolved.skip ? null : resolved.accountId
    const meta = buildMeta(config, daysAhead, resolved.skip ? null : resolved.displayName)

    // --tickets（且沒帶 --full）：只撈 ticket
    if (flags.tickets && !flags.full) {
      let ticketsResult
      try {
        ticketsResult = await fetchTargetTickets(config, { daysAhead, assigneeAccountId })
      } catch (err) {
        console.error(lightRed(`❌ 撈取 ticket 失敗：${err.message}`))
        process.exit(1)
      }
      const model = buildReportModel(
        { ticketsResult, coverage: { missing: [] }, analysis: null, targetBranches: config.targetBranches },
        meta
      )
      if (wantPretty) renderTickets(model)
      else console.log(JSON.stringify(model, null, 2))
      return
    }

    // --full：撈 ticket + 分支分析 + MR
    let data
    try {
      data = await computeFullAnalysis(config, { daysAhead, assigneeAccountId, doFetch: !flags['no-fetch'], withMr: true })
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
