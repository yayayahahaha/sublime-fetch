import { fetchTargetTickets } from './tickets.js'
import { checkRepoCoverage } from './repos.js'
import { analyzeTicketsAcrossRepos } from './branches.js'
import { enrichWithMergeRequests, findMergedMrsByKey } from './mergeRequests.js'
import { computeUrgency, classifyTicket, resolveStatusList, resolveStatusEmoji } from './assess.js'

// git contains 要檢查的分支 = staging + done 兩份清單的聯集
function checkBranchesOf(config) {
  return [...new Set([...(config.stagingBranches ?? []), ...(config.doneBranches ?? [])])]
}

/**
 * 純運算：撈 ticket → repo 涵蓋 → 分支分析 →（withMr 時）補 MR。
 * 不做任何 console 輸出（讓 model / JSON 輸出保持乾淨）。
 */
export async function computeFullAnalysis(config, { daysAhead, assigneeAccountId, doFetch, withMr, onProgress = () => {}, debug = null }) {
  onProgress('tickets')
  const ticketsResult = await fetchTargetTickets(config, { daysAhead, assigneeAccountId, debug })
  const coverage = await checkRepoCoverage(config.requiredRepos, config.localRepoPaths)
  const checkBranches = checkBranchesOf(config)

  let analysis = null
  let mrError = null
  if (ticketsResult.tickets.length > 0 && coverage.matched.length > 0) {
    onProgress('branches')
    analysis = await analyzeTicketsAcrossRepos(coverage.matched, ticketsResult.tickets, checkBranches, { doFetch, debug })
    if (withMr) {
      try {
        onProgress('mr')
        await enrichWithMergeRequests(analysis, coverage.matched, config, { debug })
      } catch (err) {
        // MR 整體查詢失敗：記下來讓報表提示（分支分析仍可用）
        mrError = err.message
      }

      // 完全找不到 branch（通常 merge 後 branch 已刪）、且 Jira 狀態不像「還在進行中」的單，
      // 額外用 jira key 到各 repo 搜 merged MR，補上合併資訊。
      const byKey = new Map(ticketsResult.tickets.map((t) => [t.key, t]))
      for (const pt of analysis.perTicket) {
        const base = byKey.get(pt.key)
        const hasAnyBranch = pt.repos.some((r) => (r.branches ?? []).length > 0)
        if (hasAnyBranch) continue
        const inDoneOrSent =
          resolveStatusList(config.doneStatuses, base?.type).includes(base?.status) ||
          resolveStatusList(config.sentToTestStatuses, base?.type).includes(base?.status)
        if (!inDoneOrSent) continue // Jira 狀態沒說完成/送測 → 不太可能已 merge，省下搜尋
        onProgress('mr-extra')
        pt.extraMergeRequests = await findMergedMrsByKey(config, coverage.matched, pt.key, { debug })
      }
    }
  }

  return { ticketsResult, coverage, analysis, stagingBranches: config.stagingBranches ?? [], doneBranches: config.doneBranches ?? [], mrError }
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
 */
export function buildReportModel(compute, meta = {}) {
  const { ticketsResult, coverage, analysis, stagingBranches = [], doneBranches = [], mrError } = compute
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
          extraMergeRequests: t.extraMergeRequests ?? [],
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

  // 每張 ticket 掛上 urgency、合併里程碑（依 issue type 選狀態清單）、jira 連結、QA emoji
  const tickets = baseTickets.map((t) => ({
    ...t,
    jiraUrl: meta.jiraBaseUrl ? `${meta.jiraBaseUrl}/browse/${t.key}` : null,
    statusEmoji: resolveStatusEmoji(meta.statusEmoji, t.status),
    urgency: computeUrgency(t.fixVersions, urgencyOpts),
    classification: classifyTicket(t, {
      stagingBranches,
      doneBranches,
      doneStatuses: resolveStatusList(meta.doneStatuses, t.type),
      sentToTestStatuses: resolveStatusList(meta.sentToTestStatuses, t.type),
    }),
  }))

  // 彙整各 repo 的 git fetch / GitLab MR 失敗（每個 repo 只留一筆）
  const fetchErrors = new Map()
  const gitlabErrors = new Map()
  for (const t of analysis?.perTicket ?? []) {
    for (const r of t.repos ?? []) {
      if (r.fetchError && !fetchErrors.has(r.required)) fetchErrors.set(r.required, r.fetchError)
      if (r.gitlabError && !gitlabErrors.has(r.required)) gitlabErrors.set(r.required, r.gitlabError)
    }
  }

  return {
    generatedAt: meta.generatedAt ?? null,
    daysAhead: meta.daysAhead ?? null,
    assignee: meta.assignee ?? null,
    jql: ticketsResult.jql ?? null,
    stagingBranches,
    doneBranches,
    versions: ticketsResult.versions.map((v) => ({ project: v.project, name: v.name, releaseDate: fmtLocalDate(v.releaseDate) })),
    skippedRepos: (coverage?.missing ?? []).map((m) => m.required),
    warnings: {
      fetchErrors: [...fetchErrors].map(([repo, error]) => ({ repo, error })),
      gitlabErrors: [...gitlabErrors].map(([repo, error]) => ({ repo, error })),
      mrError: mrError ?? null,
    },
    tickets,
  }
}
