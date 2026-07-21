// View 層：只消費 model（buildReportModel 的輸出）與 preflight 結果，負責彩色輸出。
// 這裡不做任何運算 / 打 API，純 render。
import { lightCyan, green, yellow, blue, red, lightGreen, lightRed, magenta } from '../../color.js'
import { extractVersionDate } from './fixVersion.js'
import { branchReachedTargets, repoHasSubmittedMr } from './assess.js'

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
  console.log('\n' + lightCyan(`=== Jira ticket（往後 ${model.daysAhead} 天的 fix version${assigneeSuffix}）===`) + '\n')

  if (model.versions.length === 0) {
    console.log(yellow(`找不到 date token 落在往後 ${model.daysAhead} 天內的 fix version。`))
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
    console.log(`  ${green(t.key)}  ${t.summary}`)
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

function deadlinePhrase(u) {
  const d = u.daysRemaining
  let when
  if (u.kind === 'hotfix') when = lightRed('hotfix')
  else if (d < 0) when = lightRed(`逾期 ${-d} 天`)
  else if (d === 0) when = red('今天到期')
  else when = `剩 ${d} 天`
  return `staging 截止 ${u.deadline}（${when}）`
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

// 「其他」（連送測都還沒）：列出為什麼還沒送測完成
function renderOtherTicket(t, stagingBranches, doneBranches) {
  const u = t.urgency
  const em = t.statusEmoji ? `${t.statusEmoji} ` : ''
  console.log(`  ${em}${green(t.key)}  ${t.summary}${typeTag(t)}`)
  if (t.jiraUrl) console.log(`     jira: ${t.jiraUrl}`)
  console.log(`     ${u ? `${deadlinePhrase(u)}  ← ${u.drivingVersion}` : yellow('（無法判定 deadline）')}`)
  console.log(`     Jira 狀態：${t.status}`)

  const c = t.classification ?? {}
  // 步驟 0：本地超前未 push（override，最危險）
  for (const up of c.unpushed ?? []) {
    console.log(`     ${lightRed('✗ 本地超前未 push')}：${shortRepo(up.repo)} · ${up.branch} 領先 ${up.ahead} commit（merge 後又改 / 忘記推）`)
  }

  const repos = t.repos ?? []
  const hasAnyBranch = repos.some((r) => (r.branches ?? []).length > 0)
  if (!hasAnyBranch) {
    console.log(`     ${red('✗')} 找不到任何對應 branch（可能還沒開始 / 不用改 code / branch 已刪但 Jira 未標完成）`)
  } else {
    for (const repo of repos) {
      const branches = repo.branches ?? []
      if (!branches.length) continue
      const branchIssues = branches.map((b) => ({ b, issues: branchStagingIssues(b, stagingBranches) })).filter((x) => x.issues.length)
      const submitted = repoHasSubmittedMr(repo)
      const missingDoneMr = repoMissingDoneMr(repo, doneBranches)
      if (!branchIssues.length && submitted && !missingDoneMr.length) continue

      console.log(`     ${red('✗')} ${blue(shortRepo(repo.required))}`)
      for (const { b, issues } of branchIssues) {
        console.log(`       branch: ${lightCyan(b.name)}`)
        for (const issue of issues) console.log(`         ${issue}`)
      }
      if (!submitted) console.log(`       ${red('有 branch 但還沒開任何 MR')}`)
      else for (const db of missingDoneMr) console.log(`       ${red(`未開 ${db} 的 MR`)}`)

      // 已經有的 MR 也列出連結（去重）
      const seen = new Set()
      for (const b of branches) {
        for (const mr of b.mergeRequests ?? []) {
          if (!mr.webUrl || seen.has(mr.webUrl)) continue
          seen.add(mr.webUrl)
          console.log(`       MR: ${mr.webUrl}  [${colorMrState(mr.state)}]`)
        }
      }
    }
  }
  console.log('') // 每張 ticket 之間空一行
}

function colorMrState(state) {
  if (state === 'merged') return lightGreen('merged')
  if (state === 'opened') return blue('opened')
  if (state === 'closed') return red('closed')
  return yellow(state)
}

// 已送測的單「為什麼還沒到已完成」的簡述
function sentToTestNote(t, doneBranches) {
  const hasAnyBranch = (t.repos ?? []).some((r) => (r.branches ?? []).length > 0)
  if (!hasAnyBranch) return `等 Jira 標成完成狀態（目前：${t.status}；此單無 branch，可能不用改 code）`
  const allMrs = collectMrs(t)
  const notMergedDone = doneBranches.filter((db) => !allMrs.some((m) => m.targetBranch === db && m.state === 'merged'))
  if (notMergedDone.length) return `等 ${notMergedDone.join('/')} MR merged`
  return `等 Jira 標成完成狀態（目前：${t.status}）`
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

// 已上 staging（但還沒進 develop）：依 fix version 分組列出 jira + 未進已完成合併原因 + PR
function renderStaged(staged, doneBranches) {
  if (staged.length === 0) return
  console.log(lightCyan(`── ✅ 已送測（${staged.length}）──`) + '\n')

  for (const [name, tickets] of groupByFixVersion(staged)) {
    const date = extractVersionDate(name)
    console.log(blue(`▍ ${name}${date ? `  (${fmtLocalDate(date)})` : ''}`))
    for (const t of tickets) {
      const mrs = collectMrs(t)
      const merged = mrs.filter((m) => m.state === 'merged').length
      const mrNote = mrs.length ? `MR ${merged}/${mrs.length} merged` : 'MR: -'
      const em = t.statusEmoji ? `${t.statusEmoji} ` : ''
      console.log(`  ${em}${green(t.key)}  ${t.summary}${typeTag(t)}  ${blue(`[${t.status}]`)}  ${mrNote}`)
      if (t.jiraUrl) console.log(`    jira: ${t.jiraUrl}`)

      console.log(`    ${yellow('待完成：')}${yellow(sentToTestNote(t, doneBranches))}`)
      if (t.classification?.oddMrTargets?.length) {
        console.log(`    ${yellow(`⚠ 有 MR 合併到非 dev/staging/develop：${t.classification.oddMrTargets.join(', ')}（base-branch? 請確認接續合併）`)}`)
      }

      const seen = new Set()
      for (const mr of mrs) {
        if (!mr.webUrl || seen.has(mr.webUrl)) continue
        seen.add(mr.webUrl)
        console.log(`    PR: ${mr.webUrl}  [${colorMrState(mr.state)}]`)
      }
    }
    console.log('')
  }
}

// 已完成：只列一行（單號 + 標題）；若合併目標含非 develop 才附警告
function renderDone(done) {
  if (done.length === 0) return
  console.log(lightCyan(`── 🎉 已完成（${done.length}）──`))
  for (const t of done) {
    console.log(`  ${green(t.key)}  ${t.summary}`)
    if (t.classification?.oddMrTargets?.length) {
      console.log(`     ${yellow(`⚠ 合併目標含非 develop：${t.classification.oddMrTargets.join(', ')}（base-branch? 請確認接續合併）`)}`)
    }
  }
  console.log('')
}

function renderDiscussions(model) {
  const rows = []
  for (const t of model.tickets) {
    for (const r of t.repos ?? []) {
      for (const b of r.branches ?? []) {
        if (!Array.isArray(b.mergeRequests)) continue
        for (const mr of b.mergeRequests) {
          if (mr.state === 'opened' && typeof mr.unresolvedCount === 'number' && mr.unresolvedCount > 0) {
            rows.push({ key: t.key, repo: r.required, mr })
          }
        }
      }
    }
  }
  if (rows.length === 0) return
  console.log(lightCyan('── 需處理的 MR discussions ──'))
  for (const { key, repo, mr } of rows) {
    console.log(`  ${green(key)}  ${shortRepo(repo)}  MR !${mr.iid} → ${mr.targetBranch}  ${red(`未解決 ${mr.unresolvedCount}`)}  ${mr.webUrl}`)
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
  console.log('\n' + lightCyan(`=== Release Check（往後 ${model.daysAhead} 天${assigneeSuffix}）===`) + '\n')

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
    for (const tier of TIER_SEQUENCE) {
      const group = other.filter((t) => (t.urgency?.tier ?? 'unknown') === tier)
      if (group.length === 0) continue
      group.sort(byDeadline)
      const meta = TIER_META[tier]
      console.log(meta.color(`${meta.icon} ${meta.label}（${group.length}）`) + '\n')
      for (const t of group) renderOtherTicket(t, model.stagingBranches ?? [], model.doneBranches ?? [])
    }
  }

  renderStaged(sentToTest, model.doneBranches ?? [])
  renderDone(done)
  renderDiscussions(model)
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
