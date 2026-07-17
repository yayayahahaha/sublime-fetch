// 純運算：把 fix version 規則轉成 deadline / 緊急度，以及 ticket 的完成度判定。
import { extractVersionDate } from './fixVersion.js'

const HOTFIX_RE = /hotfix/i
const STAGING_RE = /staging/i

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
 * 依 issue type 解析出一份狀態清單。
 * spec 可為陣列（所有 type 通用）或物件（{ default, "<type>": [...] }，type 比對忽略大小寫）。
 */
export function resolveStatusList(spec, type) {
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

// 單一 branch「真的」進了哪些 target：git contains，且排除空 branch（tip = 該 target head → 不算）。
export function branchReachedTargets(b) {
  const reached = new Set(b.mergedInto ?? [])
  for (const t of b.tipIsHeadOf ?? []) reached.delete(t)
  return reached
}

// 一個 repo 的 branch 們合起來「真的」進了哪些 target
export function repoReachedTargets(repo) {
  const s = new Set()
  for (const b of repo.branches ?? []) for (const t of branchReachedTargets(b)) s.add(t)
  return s
}

// 一個 repo 有沒有「送出過」的 MR（opened 或 merged）
export function repoHasSubmittedMr(repo) {
  return (repo.branches ?? []).some((b) => Array.isArray(b.mergeRequests) && b.mergeRequests.some((m) => m.state === 'opened' || m.state === 'merged'))
}

/**
 * 把 ticket 分成 done / sentToTest / other。
 * 判定順序：步驟 0 未 push override → 步驟 1 已完成 → 步驟 2 已送測 → 其他。
 * 回傳 { category, unpushed:[{repo,branch,ahead}], oddMrTargets:[...] }
 */
export function classifyTicket(ticket, { stagingBranches = [], doneBranches = [], doneStatuses = [], sentToTestStatuses = [] } = {}) {
  const repos = ticket.repos ?? []
  const involvedRepos = repos.filter((r) => (r.branches ?? []).length > 0)
  const hasAnyBranch = involvedRepos.length > 0

  const allMrs = [
    ...repos.flatMap((r) => (r.branches ?? []).flatMap((b) => (Array.isArray(b.mergeRequests) ? b.mergeRequests : []))),
    ...(ticket.extraMergeRequests ?? []),
  ]
  const hasOpenMrAnywhere = allMrs.some((m) => m.state === 'opened')

  // 送出過 / merged 的 MR 若 target 不是已知分支（dev/staging/done）→ 提示（協作 base-branch）
  const known = new Set([...stagingBranches, ...doneBranches])
  const oddMrTargets = [
    ...new Set(
      allMrs
        .filter((m) => (m.state === 'opened' || m.state === 'merged') && m.targetBranch && !known.has(m.targetBranch))
        .map((m) => m.targetBranch)
    ),
  ]

  // 步驟 0：本地超前未 push → 其他（override）
  const unpushed = []
  for (const r of repos) for (const b of r.branches ?? []) {
    if (b.hasRemote && b.ahead > 0) unpushed.push({ repo: r.required, branch: b.name, ahead: b.ahead })
  }
  if (unpushed.length) return { category: 'other', unpushed, oddMrTargets }

  // 步驟 1：已完成（Jira 狀態必要 + 無 open MR + 每 branch 進 doneBranches；沒 branch 信 Jira）
  const isDone = (() => {
    if (!doneStatuses.includes(ticket.status)) return false
    if (hasOpenMrAnywhere) return false
    if (!hasAnyBranch) return true
    return involvedRepos.every((r) => {
      const reached = repoReachedTargets(r)
      return doneBranches.every((db) => reached.has(db))
    })
  })()
  if (isDone) return { category: 'done', unpushed: [], oddMrTargets }

  // 步驟 2：已送測（有 branch → 每 repo 上 staging + 每 repo 送出過 MR；沒 branch → 靠 Jira 狀態）
  const isSentToTest = (() => {
    if (hasAnyBranch) {
      const mergedStaging = involvedRepos.every((r) => {
        const reached = repoReachedTargets(r)
        return stagingBranches.every((sb) => reached.has(sb))
      })
      const submitted = involvedRepos.every((r) => repoHasSubmittedMr(r))
      return mergedStaging && submitted
    }
    return sentToTestStatuses.includes(ticket.status)
  })()
  if (isSentToTest) return { category: 'sentToTest', unpushed: [], oddMrTargets }

  return { category: 'other', unpushed: [], oddMrTargets }
}
