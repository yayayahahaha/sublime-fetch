// View 層：只消費 model（buildReportModel 的輸出）與 preflight 結果，負責彩色輸出。
// 這裡不做任何運算 / 打 API，純 render。
import { lightCyan, green, yellow, blue, red, lightGreen, lightRed, magenta } from '../../color.js'

// issue type 標籤（例：(Task) / (Job Order)），沒有 type 就空字串
function typeTag(t) {
  return t.type ? `  ${magenta(`(${t.type})`)}` : ''
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
  return out
}

function renderIncompleteTicket(t) {
  const u = t.urgency
  console.log(`  ${green(t.key)}  ${t.summary}${typeTag(t)}`)
  if (t.jiraUrl) console.log(`     jira: ${t.jiraUrl}`)
  console.log(`     ${u ? `${deadlinePhrase(u)}  ← ${u.drivingVersion}` : yellow('（無法判定 deadline）')}`)

  const c = t.completeness
  if (c.jiraNotDone) console.log(`     ${red('✗')} Jira 狀態：${t.status}`)

  if (!c.hasAnyBranch) {
    console.log(`     ${red('✗')} 找不到任何對應 branch（可能還沒開始）`)
  } else {
    for (const repo of c.repos) {
      const branchesWithIssues = repo.branches.filter((b) => b.issues.length)
      if (branchesWithIssues.length === 0) continue
      console.log(`     ${red('✗')} ${blue(shortRepo(repo.required))}`)
      for (const b of branchesWithIssues) {
        console.log(`       branch: ${lightCyan(b.name)}`)
        for (const issue of b.issues) console.log(`         ${issue}`)
      }
    }
  }
  console.log('') // 每張 ticket 之間空一行
}

function renderCompleted(complete) {
  if (complete.length === 0) return
  console.log(lightCyan(`── ✅ 已完成（${complete.length}）──`))
  for (const t of complete) {
    const mrs = collectMrs(t)
    const merged = mrs.filter((m) => m.state === 'merged').length
    const mrNote = mrs.length ? `MR ${merged}/${mrs.length} merged` : 'MR: -'
    console.log(`  ${green(t.key)}  ${t.summary}${typeTag(t)}  ${blue(`[${t.status}]`)}  ${mrNote}`)
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

// MR 連結（可整段複製貼給 reviewer），分成 opened 與其他兩區
function renderMrLinks(model) {
  const seen = new Set()
  const opened = []
  const others = []
  for (const t of model.tickets) {
    for (const r of t.repos ?? []) {
      for (const b of r.branches ?? []) {
        if (!Array.isArray(b.mergeRequests)) continue
        for (const mr of b.mergeRequests) {
          if (!mr.webUrl || seen.has(mr.webUrl)) continue
          seen.add(mr.webUrl)
          if (mr.state === 'opened') opened.push({ url: mr.webUrl, emoji: t.statusEmoji, status: t.status })
          else others.push(mr.webUrl)
        }
      }
    }
  }

  if (opened.length) {
    console.log(lightCyan(`── 待 review 的 MR 連結（opened，${opened.length}）──`))
    for (const o of opened) console.log(o.emoji ? `${o.url}  ${o.emoji} ${o.status}` : o.url)
    console.log('')
  }
  if (others.length) {
    console.log(lightCyan(`── 其他 MR 連結（已 merged / closed，${others.length}）──`))
    for (const url of others) console.log(url)
    console.log('')
  }
}

// 主報表：待完成（依緊急度分桶）+ 已完成 + MR discussions
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

  const incomplete = model.tickets.filter((t) => !t.completeness.done)
  const complete = model.tickets.filter((t) => t.completeness.done)

  console.log(lightCyan('── 待完成（依緊急度）──') + '\n')
  if (incomplete.length === 0) {
    console.log(lightGreen('  🎉 沒有待完成項目') + '\n')
  } else {
    for (const tier of TIER_SEQUENCE) {
      const group = incomplete.filter((t) => (t.urgency?.tier ?? 'unknown') === tier)
      if (group.length === 0) continue
      group.sort(byDeadline)
      const meta = TIER_META[tier]
      console.log(meta.color(`${meta.icon} ${meta.label}（${group.length}）`) + '\n')
      for (const t of group) renderIncompleteTicket(t)
    }
  }

  renderCompleted(complete)
  renderMrLinks(model)
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
