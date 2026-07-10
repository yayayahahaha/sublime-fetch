import { fetchTargetTickets } from './tickets.js'
import { checkRepoCoverage } from './repos.js'
import { analyzeTicketsAcrossRepos } from './branches.js'
import { enrichWithMergeRequests } from './mergeRequests.js'
import { computeUrgency, assessCompleteness, resolveStatusList, resolveStatusEmoji } from './assess.js'

/**
 * 純運算：撈 ticket → repo 涵蓋 → 分支分析 →（withMr 時）補 MR。
 * 不做任何 console 輸出（讓 model / JSON 輸出保持乾淨）。
 * 回傳 { ticketsResult, coverage, analysis, targetBranches }（analysis 可能為 null）。
 */
export async function computeFullAnalysis(config, { daysAhead, assigneeAccountId, doFetch, withMr, onProgress = () => {} }) {
  onProgress('tickets')
  const ticketsResult = await fetchTargetTickets(config, { daysAhead, assigneeAccountId })
  const coverage = await checkRepoCoverage(config.requiredRepos, config.localRepoPaths)

  let analysis = null
  if (ticketsResult.tickets.length > 0 && coverage.matched.length > 0) {
    onProgress('branches')
    analysis = await analyzeTicketsAcrossRepos(coverage.matched, ticketsResult.tickets, config.targetBranches, { doFetch })
    if (withMr) {
      try {
        onProgress('mr')
        await enrichWithMergeRequests(analysis, coverage.matched, config)
      } catch {
        // MR 整體查詢失敗就維持沒有 MR 欄位（分支分析仍可用）
      }
    }
  }

  return { ticketsResult, coverage, analysis, targetBranches: config.targetBranches }
}

function fmtLocalDate(date) {
  if (!date) return null
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 把運算結果轉成「唯一真相來源」的 model 物件（可直接 JSON.stringify，也是 render 層的輸入）。
 * compute：computeFullAnalysis 的回傳（tickets-only 時可傳 { ticketsResult, targetBranches } 即可）。
 * meta：{ daysAhead, assignee, generatedAt }
 */
export function buildReportModel(compute, meta = {}) {
  const { ticketsResult, coverage, analysis, targetBranches } = compute
  const byKey = new Map(ticketsResult.tickets.map((t) => [t.key, t]))
  const urgencyOpts = { today: meta.today ?? new Date(), urgentWithinDays: meta.urgentWithinDays ?? 3, customRegex: meta.dateTokenRegex ?? null }

  const baseTickets = analysis
    ? analysis.perTicket.map((t) => {
        const base = byKey.get(t.key)
        return {
          key: t.key,
          summary: t.summary,
          status: base?.status ?? null,
          type: base?.type ?? null,
          fixVersions: base?.fixVersions ?? [],
          repos: t.repos,
        }
      })
    : ticketsResult.tickets.map((t) => ({
        key: t.key,
        summary: t.summary,
        status: t.status,
        type: t.type ?? null,
        fixVersions: t.fixVersions,
        repos: [],
      }))

  // 每張 ticket 掛上推導出的 urgency、completeness（依 issue type 選狀態清單）、jira 連結
  const tickets = baseTickets.map((t) => ({
    ...t,
    jiraUrl: meta.jiraBaseUrl ? `${meta.jiraBaseUrl}/browse/${t.key}` : null,
    statusEmoji: resolveStatusEmoji(meta.statusEmoji, t.status),
    urgency: computeUrgency(t.fixVersions, urgencyOpts),
    completeness: assessCompleteness(t, {
      notDoneStatuses: resolveStatusList(meta.notDoneStatuses, t.type),
      doneStatuses: resolveStatusList(meta.doneStatuses, t.type),
    }),
  }))

  return {
    generatedAt: meta.generatedAt ?? null,
    daysAhead: meta.daysAhead ?? null,
    assignee: meta.assignee ?? null,
    jql: ticketsResult.jql ?? null,
    targetBranches: targetBranches ?? [],
    versions: ticketsResult.versions.map((v) => ({ project: v.project, name: v.name, releaseDate: fmtLocalDate(v.releaseDate) })),
    skippedRepos: (coverage?.missing ?? []).map((m) => m.required),
    tickets,
  }
}
