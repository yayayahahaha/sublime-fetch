// 純運算：把 fix version 規則轉成 deadline / 緊急度，以及 ticket 的完成度判定。
import { extractVersionDate } from './fixVersion.js'

const HOTFIX_RE = /hotfix/i
const STAGING_RE = /staging/i
const REQUIRED_MERGE = ['dev', 'staging'] // 完成所需 merge 的目標分支（嚴格）

function fmtLocalDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 兩個日期相差幾天（本地日對齊，to - from）
function daysBetween(from, to) {
  const a = new Date(from)
  a.setHours(0, 0, 0, 0)
  const b = new Date(to)
  b.setHours(0, 0, 0, 0)
  return Math.round((b - a) / 86400000)
}

/**
 * 解析單一 fix version 名稱 → { name, kind, deadline }（沒有日期 token 則回 null）。
 * - 含 hotfix → kind=hotfix，deadline=版本日
 * - 含 Staging → kind=staging，deadline=版本日
 * - 皆無 → kind=preweek，deadline=版本日 − 7 天
 */
export function assessVersion(name, customRegex = null) {
  const date = extractVersionDate(name, customRegex)
  if (!date) return null

  if (HOTFIX_RE.test(name)) return { name, kind: 'hotfix', deadline: new Date(date) }
  if (STAGING_RE.test(name)) return { name, kind: 'staging', deadline: new Date(date) }
  const deadline = new Date(date)
  deadline.setDate(deadline.getDate() - 7)
  return { name, kind: 'preweek', deadline }
}

const TIER_ORDER = { hotfix: 0, overdue: 1, urgent: 2, later: 3 }

/**
 * 從 ticket 的多個 fixVersion 名稱算出「最急」的 urgency。
 * 回傳 { tier, kind, deadline(字串), daysRemaining, drivingVersion } 或 null（都沒日期）。
 */
export function computeUrgency(fixVersionNames, { today = new Date(), urgentWithinDays = 3, customRegex = null } = {}) {
  const scored = (fixVersionNames ?? [])
    .map((n) => assessVersion(n, customRegex))
    .filter(Boolean)
    .map((v) => {
      const daysRemaining = daysBetween(today, v.deadline)
      let tier
      if (v.kind === 'hotfix') tier = 'hotfix'
      else if (daysRemaining < 0) tier = 'overdue'
      else if (daysRemaining <= urgentWithinDays) tier = 'urgent'
      else tier = 'later'
      return { ...v, daysRemaining, tier }
    })

  if (scored.length === 0) return null

  // 最急：tier 序優先，其次 deadline 早者
  scored.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.deadline - b.deadline)
  const top = scored[0]
  return {
    tier: top.tier,
    kind: top.kind,
    deadline: fmtLocalDate(top.deadline),
    daysRemaining: top.daysRemaining,
    drivingVersion: top.name,
  }
}

/**
 * 依 issue type 解析出該用哪份「未完成」狀態清單。
 * spec 可為陣列（所有 type 通用）或物件（{ default, "<type>": [...] }，type 比對忽略大小寫）。
 */
export function resolveNotDoneStatuses(spec, type) {
  if (Array.isArray(spec)) return spec
  if (spec && typeof spec === 'object') {
    if (type) {
      const key = Object.keys(spec).find((k) => k.toLowerCase() === String(type).toLowerCase())
      if (key) return spec[key]
    }
    return spec.default ?? []
  }
  return []
}

/**
 * 依 status 對應出 emoji（表示 QA 狀態）。找不到就用保留 key __default__，再沒有回空字串。
 */
export function resolveStatusEmoji(map, status) {
  if (!map || typeof map !== 'object') return ''
  return map[status] ?? map.__default__ ?? ''
}

// 單一 branch 還缺哪些（merge dev/staging、push、MR）
function branchIssues(b) {
  const issues = []
  for (const target of REQUIRED_MERGE) {
    if (!b.mergedInto?.includes(target)) issues.push(`未 merge ${target}`)
  }
  if (!b.hasRemote) issues.push('本地分支尚未 push')
  else if (b.hasLocal && b.ahead > 0) issues.push(`本地領先 ${b.ahead} 未 push`)

  // 只有做過 MR enrich 才判定「開 MR」；opened 或 merged 皆算已開
  if (b.mergeRequests !== undefined) {
    const hasMr = Array.isArray(b.mergeRequests) && b.mergeRequests.some((m) => m.state === 'opened' || m.state === 'merged')
    if (!hasMr) issues.push('未開 MR')
  }
  return issues
}

/**
 * 判定一張 ticket 的完成度。
 * 回傳 { done, jiraNotDone, hasAnyBranch, repos: [{ required, branches: [{name, issues}] }] }
 */
export function assessCompleteness(ticket, { notDoneStatuses = [] } = {}) {
  const jiraNotDone = notDoneStatuses.includes(ticket.status)

  const repos = (ticket.repos ?? []).map((r) => ({
    required: r.required,
    branches: (r.branches ?? []).map((b) => ({ name: b.name, issues: branchIssues(b) })),
  }))

  const allBranches = repos.flatMap((r) => r.branches)
  const hasAnyBranch = allBranches.length > 0
  const gitClean = hasAnyBranch && allBranches.every((b) => b.issues.length === 0)

  return { done: !jiraNotDone && gitClean, jiraNotDone, hasAnyBranch, repos }
}
