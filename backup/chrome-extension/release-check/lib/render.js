// View 層：只消費 model（buildReportModel 的輸出）與 preflight 結果，負責彩色輸出。
// 這裡不做任何運算 / 打 API，純 render。
import Table from 'cli-table3'
import { lightCyan, green, yellow, blue, red, lightGreen, lightRed, magenta } from '../../color.js'
import { extractVersionDate } from './fixVersion.js'
import { branchReachedTargets, repoReachedTargets, repoHasSubmittedMr } from './assess.js'

// OSC 8 終端機超連結；不支援的終端機/CI 可用 setHyperlinks(false) 退回純文字+URL
let useHyperlinks = true
export function setHyperlinks(on) {
  useHyperlinks = on
}
function link(text, url) {
  if (!url) return text
  if (!useHyperlinks) return `${text} (${url})`
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`
}

// ticket 單號 → 可點的 jira 連結（點擊開 jira）
function keyLabel(t) {
  return link(green(t.key), t.jiraUrl)
}

// MR 短標籤（可點）：MR !iid → target
function mrLabel(mr) {
  return link(`MR !${mr.iid} → ${mr.targetBranch}`, mr.webUrl)
}

// 把狀態設定（陣列或依 issue type 的物件）格式化成可讀多行
function formatStatusSpec(spec) {
  if (Array.isArray(spec)) return `    ${spec.length ? spec.join(', ') : '(空)'}`
  if (spec && typeof spec === 'object') {
    const entries = Object.entries(spec)
    if (!entries.length) return '    (未設定)'
    return entries.map(([k, v]) => `    ${k}：${(Array.isArray(v) ? v : []).join(', ') || '(空)'}`).join('\n')
  }
  return '    (未設定)'
}

// 流程開始前印出目前的判定規則，方便確認 config
export function renderRules(config) {
  console.log('\n' + lightCyan('=== 判定規則（來自 config）===') + '\n')
  console.log(`${blue('已送測需 merge 進：')} ${(config.stagingBranches ?? []).join(' + ') || '(未設定)'}`)
  console.log(`${blue('已完成需 merge 進（develop）：')} ${(config.doneBranches ?? []).join(' + ') || '(未設定)'}`)
  console.log(blue('doneStatuses（已完成的必要 Jira 狀態；還會用 git 驗證 develop contains）：'))
  console.log(formatStatusSpec(config.doneStatuses))
  console.log(blue('sentToTestStatuses（沒 branch 時 → 已送測，如不用改 code / branch 已刪）：'))
  console.log(formatStatusSpec(config.sentToTestStatuses))
  console.log(`${blue('緊迫門檻：')} staging deadline 在今天起 ${config.urgentWithinDays ?? 3} 天內算緊迫`)
  console.log(blue('fix version → staging deadline：'))
  console.log('    含 hotfix → 最緊急（deadline = 版本日）')
  console.log('    含 Staging → deadline = 版本日當天')
  console.log('    皆無 → deadline = 版本日前 7 天')
  console.log('')
}

// issue type 標籤（例：(Task) / (Job Order)），沒有 type 就空字串
function typeTag(t) {
  return t.type ? `  ${magenta(`(${t.type})`)}` : ''
}

function fmtLocalDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// ticket 清單（fix version + ticket 摘要），供「只撈 ticket」使用
export function renderTickets(model) {
  const assigneeSuffix = model.assignee ? `，assignee = ${model.assignee}` : ''
  console.log('\n' + lightCyan(`=== Jira ticket（${model.windowLabel} 的 fix version${assigneeSuffix}）===`) + '\n')

  if (model.versions.length === 0) {
    console.log(yellow(`找不到 date token 落在時間窗（${model.windowLabel}）內的 fix version。`))
    return
  }

  console.log(blue(`符合的 fix version（${model.versions.length}）：`))
  for (const v of model.versions) {
    console.log(`  • ${v.releaseDate}  ${v.name}  ${yellow(`[${v.project}]`)}`)
  }
  console.log('')

  if (model.tickets.length === 0) {
    console.log(yellow('這些版本底下沒有任何 ticket。'))
    return
  }

  console.log(blue(`Ticket（${model.tickets.length}）：`))
  for (const t of model.tickets) {
    console.log(`  ${keyLabel(t)}  ${t.summary}`)
    console.log(`      status: ${t.status}   fixVersions: ${t.fixVersions.join(', ')}`)
  }
  console.log('')
}

const TIER_META = {
  hotfix: { icon: '🔥', label: 'HOTFIX', color: lightRed },
  overdue: { icon: '🔴', label: '逾期', color: lightRed },
  urgent: { icon: '🟠', label: '緊迫', color: yellow },
  later: { icon: '🟢', label: '餘裕', color: green },
  unknown: { icon: '❔', label: '無法判定 deadline', color: yellow },
}
const TIER_SEQUENCE = ['hotfix', 'overdue', 'urgent', 'later', 'unknown']

function byDeadline(a, b) {
  return (a.urgency?.daysRemaining ?? Infinity) - (b.urgency?.daysRemaining ?? Infinity)
}

// 只取 repo 路徑末段（例：.../btse-frontend/exchange-app → exchange-app）
function shortRepo(required) {
  return String(required)
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .split('/')
    .pop()
}


function collectMrs(t) {
  const out = []
  for (const r of t.repos ?? []) {
    for (const b of r.branches ?? []) {
      if (Array.isArray(b.mergeRequests)) out.push(...b.mergeRequests)
    }
  }
  if (Array.isArray(t.extraMergeRequests)) out.push(...t.extraMergeRequests)
  return out
}

// 單一 branch 還缺哪些才能上 staging（未 merge dev/staging、未 push）。develop MR 在 repo 層另外檢查。
function branchStagingIssues(b, stagingBranches) {
  const reached = branchReachedTargets(b)
  const issues = []
  for (const t of stagingBranches) if (!reached.has(t)) issues.push(`未 merge ${t}`)

  const hasMergedMr = (b.mergeRequests ?? []).some((m) => m.state === 'merged')
  if (!b.hasRemote && !hasMergedMr) issues.push('本地分支尚未 push')
  else if (b.hasRemote && b.hasLocal && b.ahead > 0) issues.push(`本地領先 ${b.ahead} 未 push`)
  return issues
}

// 某 repo 缺哪些 doneBranch 的 MR（送測需要 develop 的 MR 已開好）
function repoMissingDoneMr(repo, doneBranches) {
  const mrs = (repo.branches ?? []).flatMap((b) => (Array.isArray(b.mergeRequests) ? b.mergeRequests : []))
  return doneBranches.filter((db) => !mrs.some((m) => m.targetBranch === db && (m.state === 'opened' || m.state === 'merged')))
}

// 緊急度 cell：icon + 剩/逾期天數
function urgencyCell(t) {
  const u = t.urgency
  if (!u) return TIER_META.unknown.icon
  const meta = TIER_META[u.tier] ?? TIER_META.unknown
  let when
  if (u.kind === 'hotfix') when = 'hotfix'
  else if (u.daysRemaining < 0) when = `逾期${-u.daysRemaining}天`
  else if (u.daysRemaining === 0) when = '今天'
  else when = `剩${u.daysRemaining}天`
  return meta.color(`${meta.icon} ${when}`)
}

// Merge 狀態 cell：每個 stagingBranch 一個 ✅/❌（每個有 branch 的 repo 都達成才 ✅）
function mergeCell(t, stagingBranches) {
  const involved = (t.repos ?? []).filter((r) => (r.branches ?? []).length > 0)
  if (!involved.length) return '-'
  return stagingBranches.map((sb) => (involved.every((r) => repoReachedTargets(r).has(sb)) ? green('✅') : red('❌'))).join('/')
}

// Push 狀態 cell：任一 branch 有未 push 就 ❌
function pushCell(t) {
  const branches = (t.repos ?? []).flatMap((r) => r.branches ?? [])
  if (!branches.length) return '-'
  const anyIssue = branches.some((b) => {
    const hasMergedMr = (b.mergeRequests ?? []).some((m) => m.state === 'merged')
    if (!b.hasRemote && !hasMergedMr) return true
    if (b.hasRemote && b.hasLocal && b.ahead > 0) return true
    return false
  })
  return anyIssue ? red('❌') : green('✅')
}

// MR cell：列出 MR 連結（去重），無則 '-'
function mrCellCompact(t) {
  const mrs = uniqueMrs(t)
  if (!mrs.length) return '-'
  return mrs.map((mr) => `${mrLabel(mr)} [${colorMrState(mr.state)}]`).join('\n')
}

// 一張「其他」ticket 的原因（給表格下方註解用）
function otherReasons(t, stagingBranches, doneBranches) {
  const out = []
  for (const up of t.classification?.unpushed ?? []) {
    out.push(`本地超前未 push：${shortRepo(up.repo)}·${up.branch} 領先 ${up.ahead}（最危險）`)
  }
  const repos = t.repos ?? []
  if (!repos.some((r) => (r.branches ?? []).length > 0)) {
    out.push('找不到對應 branch（可能還沒開始 / 不用改 code / branch 已刪但 Jira 未標完成）')
    return out
  }
  for (const repo of repos) {
    const branches = repo.branches ?? []
    if (!branches.length) continue
    for (const b of branches) {
      const issues = branchStagingIssues(b, stagingBranches)
      if (issues.length) out.push(`${shortRepo(repo.required)}·${b.name}：${issues.join('、')}`)
    }
    if (!repoHasSubmittedMr(repo)) out.push(`${shortRepo(repo.required)}：有 branch 但還沒開任何 MR`)
    else {
      const missing = repoMissingDoneMr(repo, doneBranches)
      if (missing.length) out.push(`${shortRepo(repo.required)}：未開 ${missing.join('/')} 的 MR`)
    }
  }
  return out
}

// 「其他」整區用一張表呈現（依緊急度排序），原因收在表格下方
// 是否為 Staging 版本（這類要往後排）
function isStagingVersion(name) {
  return /staging/i.test(name ?? '')
}

// 一張 ticket 的 fix version 顯示：非 Staging 依日期由近到遠在前，Staging 版本一律往後排。
function fixVersionCell(t) {
  const names = t.fixVersions ?? []
  if (names.length === 0) return '-'
  const sorted = [...names].sort((a, b) => {
    const sa = isStagingVersion(a) ? 1 : 0
    const sb = isStagingVersion(b) ? 1 : 0
    if (sa !== sb) return sa - sb // 非 Staging 在前
    const da = extractVersionDate(a)?.getTime() ?? Infinity
    const db = extractVersionDate(b)?.getTime() ?? Infinity
    return da - db || a.localeCompare(b)
  })
  return sorted.map((name) => (isStagingVersion(name) ? name : yellow(name))).join('\n')
}

function renderOtherTable(tickets, model) {
  const stagingBranches = model.stagingBranches ?? []
  const doneBranches = model.doneBranches ?? []
  const table = new Table({
    head: ['緊急', 'Ticket', '標題', 'Fix Version', 'Status', `Merge(${stagingBranches.join('/')})`, 'Push', 'MR'].map((h) => blue(h)),
    style: { head: [], border: ['dim'] },
  })
  for (const t of tickets) {
    table.push([urgencyCell(t), keyLabel(t), truncate(t.summary, 40), fixVersionCell(t), `${t.statusEmoji ? t.statusEmoji + ' ' : ''}${t.status}`, mergeCell(t, stagingBranches), pushCell(t), mrCellCompact(t)])
  }
  console.log(table.toString())

  const withReasons = tickets.map((t) => ({ t, reasons: otherReasons(t, stagingBranches, doneBranches) })).filter((x) => x.reasons.length)
  if (withReasons.length) {
    console.log('\n' + yellow('原因參考：'))
    for (const { t, reasons } of withReasons) console.log(`  ${green(t.key)}  ${yellow(reasons.join('；'))}`)
  }
  console.log('')
}

function colorMrState(state) {
  if (state === 'merged') return lightGreen('merged')
  if (state === 'opened') return blue('opened')
  if (state === 'closed') return red('closed')
  return yellow(state)
}

// 依 fix version 分組（一張 ticket 有多個版本就在多組重複出現），群組依版本日期排序
function groupByFixVersion(tickets) {
  const groups = new Map()
  for (const t of tickets) {
    for (const name of t.fixVersions ?? []) {
      if (!groups.has(name)) groups.set(name, [])
      groups.get(name).push(t)
    }
  }
  return [...groups.entries()].sort(([a], [b]) => {
    const da = extractVersionDate(a)?.getTime() ?? Infinity
    const db = extractVersionDate(b)?.getTime() ?? Infinity
    return da - db || a.localeCompare(b)
  })
}

// 依 fix version 分組，每組一張表（Ticket / Status / MR / 討論核准 / 標題 / 類型）
function renderFixVersionTables(tickets) {
  for (const [name, group] of groupByFixVersion(tickets)) {
    const date = extractVersionDate(name)
    console.log(blue(`▍ ${name}${date ? `  (${fmtLocalDate(date)})` : ''}`))
    const table = new Table({
      head: ['Ticket', '標題', 'Status', 'MR / 狀態', '討論/核准', '類型'].map((h) => blue(h)),
      style: { head: [], border: ['dim'] },
    })
    for (const t of group) {
      const mrs = uniqueMrs(t)
      const mrCell = mrs.length ? mrs.map((mr) => `${mrLabel(mr)}  [${colorMrState(mr.state)}]`).join('\n') : '-'
      const countCell = mrs.length
        ? mrs.map((mr) => {
            const parts = []
            if (typeof mr.unresolvedCount === 'number') parts.push(mr.unresolvedCount > 0 ? red(`💬${mr.unresolvedCount}`) : `💬0`)
            if (typeof mr.approvedCount === 'number') parts.push(`✅${mr.approvedCount}`)
            return parts.length ? parts.join('  ') : '-'
          }).join('\n')
        : '-'
      const status = `${t.statusEmoji ? t.statusEmoji + ' ' : ''}${t.status}`
      table.push([keyLabel(t), truncate(t.summary, 48), status, mrCell, countCell, t.type ?? '-'])
    }
    console.log(table.toString())
    console.log('')
  }
}

function renderDiscussions(model) {
  const rows = []
  for (const t of model.tickets) {
    for (const r of t.repos ?? []) {
      for (const b of r.branches ?? []) {
        if (!Array.isArray(b.mergeRequests)) continue
        for (const mr of b.mergeRequests) {
          if ((mr.state === 'opened' || mr.state === 'merged') && typeof mr.unresolvedCount === 'number' && mr.unresolvedCount > 0) {
            rows.push({ t, repo: r.required, mr })
          }
        }
      }
    }
  }
  if (rows.length === 0) return
  console.log(lightCyan('── 需處理的 MR discussions ──'))
  for (const { t, repo, mr } of rows) {
    console.log(`  ${keyLabel(t)}  ${shortRepo(repo)}  ${mrLabel(mr)}  [${colorMrState(mr.state)}]  ${red(`未解決 ${mr.unresolvedCount}`)}`)
  }
  console.log('')
}

// 執行過程中的失敗提示（git fetch / GitLab MR 失敗；Jira 失敗會直接中止不會走到這）
function renderWarnings(warnings) {
  if (!warnings) return
  const { fetchErrors = [], gitlabErrors = [], mrError } = warnings
  if (fetchErrors.length === 0 && gitlabErrors.length === 0 && !mrError) return

  console.log(lightRed('── ⚠ 執行時發生錯誤 ──'))
  for (const { repo, error } of fetchErrors) {
    console.log(`  ${yellow('git fetch 失敗')}：${shortRepo(repo)}（改用本地既有資料，合併狀態可能不是最新）— ${error}`)
  }
  for (const { repo, error } of gitlabErrors) {
    console.log(`  ${yellow('GitLab MR 查詢失敗')}：${shortRepo(repo)}（該 repo 的 MR 狀態可能不準）— ${error}`)
  }
  if (mrError) {
    console.log(`  ${yellow('GitLab MR 整體查詢失敗')}：所有 MR 狀態皆缺 — ${mrError}`)
  }
  console.log('')
}

// 主報表：警告 + 待完成（依緊急度分桶）+ 已上 staging + 已完成合併 + MR discussions
export function renderReport(model) {
  const assigneeSuffix = model.assignee ? `, assignee=${model.assignee}` : ''
  console.log('\n' + lightCyan(`=== Release Check（${model.windowLabel}${assigneeSuffix}）===`) + '\n')

  if (model.tickets.length === 0) {
    console.log(yellow('本次沒有符合的 ticket。\n'))
    return
  }

  if (model.skippedRepos?.length) {
    console.log(yellow(`⚠ 略過未對應到本地的必檢 repo：${model.skippedRepos.join(', ')}`) + '\n')
  }

  renderWarnings(model.warnings)

  const other = model.tickets.filter((t) => t.classification?.category === 'other')
  const sentToTest = model.tickets.filter((t) => t.classification?.category === 'sentToTest')
  const done = model.tickets.filter((t) => t.classification?.category === 'done')

  console.log(lightCyan('── 其他（連送測都還沒，需處理，依緊急度）──') + '\n')
  if (other.length === 0) {
    console.log(lightGreen('  🎉 沒有待處理項目') + '\n')
  } else {
    const sorted = []
    for (const tier of TIER_SEQUENCE) sorted.push(...other.filter((t) => (t.urgency?.tier ?? 'unknown') === tier).sort(byDeadline))
    renderOtherTable(sorted, model)
  }

  if (sentToTest.length) {
    console.log(lightCyan(`── ✅ 已送測（${sentToTest.length}，依 fix version）──`) + '\n')
    renderFixVersionTables(sentToTest)
  }
  if (done.length) {
    console.log(lightCyan(`── 🎉 已完成（${done.length}，依 fix version）──`) + '\n')
    renderFixVersionTables(done)
  }
  renderDiscussions(model)
}

function truncate(s, n) {
  s = s ?? ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

// 去重後的 MR（依 webUrl）
function uniqueMrs(t) {
  const seen = new Set()
  const out = []
  for (const mr of collectMrs(t)) {
    if (!mr.webUrl || seen.has(mr.webUrl)) continue
    seen.add(mr.webUrl)
    out.push(mr)
  }
  return out
}

// Preflight 檢查結果
export function renderPreflight({ checks, ok }) {
  console.log('\n' + lightCyan('=== Preflight 檢查 ===') + '\n')
  for (const check of checks) {
    const mark = check.ok ? green('✅') : red('❌')
    console.log(`${mark} ${check.ok ? green(check.name) : lightRed(check.name)}`)
    if (check.detail) console.log(`   ${check.detail}`)
    if (!check.ok && check.hint) console.log(`   ${yellow('→ ' + check.hint)}`)

    if (check.coverage) {
      const { matched, missing, unmatchedLocals } = check.coverage
      for (const m of matched) console.log(`   ${green('✓')} ${m.required}  ←  ${m.local.path}`)
      for (const m of missing) console.log(`   ${red(`✗ 缺少：${m.required}`)}`)
      for (const l of unmatchedLocals) {
        const reason = l.error || (l.identity ? '不在必檢清單' : '無法辨識 remote')
        console.log(`   ${yellow(`• 未對應的本地路徑：${l.path}（${reason}）`)}`)
      }
    }
    console.log('')
  }
  console.log(ok ? lightGreen('✅ Preflight 全數通過，可以進入下一階段。') + '\n' : lightRed('❌ Preflight 未通過，請依上面提示修正後再跑一次。') + '\n')
}
