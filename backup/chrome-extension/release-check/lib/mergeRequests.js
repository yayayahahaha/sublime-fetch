import { GitlabClient } from './gitlab.js'
import { extractRepoPath } from './repos.js'

function shortErr(err) {
  return (err?.message || String(err)).split('\n')[0].slice(0, 200)
}

function mapMr(mr) {
  return {
    iid: mr.iid,
    title: mr.title,
    state: mr.state, // opened / closed / merged / locked
    targetBranch: mr.target_branch,
    sourceBranch: mr.source_branch,
    webUrl: mr.web_url,
  }
}

// 數出未解決的討論串：可解決（resolvable）且尚未 resolved 的 thread
function countUnresolvedDiscussions(discussions) {
  let count = 0
  for (const d of discussions) {
    const resolvableNotes = (d.notes ?? []).filter((n) => n.resolvable)
    if (resolvableNotes.length === 0) continue
    if (!resolvableNotes.every((n) => n.resolved)) count++
  }
  return count
}

/**
 * 把 Phase 3 的分支分析結果，補上每個（已 push 的）分支對應的 GitLab MR。
 * 會在每個 branch 掛上 b.mergeRequests（陣列 / null 代表查詢失敗）。
 * matchedRepos：checkRepoCoverage() 的 matched（用 remoteUrl 推導 GitLab project path）。
 */
export async function enrichWithMergeRequests(analysis, matchedRepos, config, { debug = null, onProgress = () => {} } = {}) {
  const gitlab = new GitlabClient(config.gitlab)

  // required -> GitLab project 路徑（保留大小寫，優先用本地 origin remote 的真實路徑）
  const pathByRequired = new Map()
  for (const m of matchedRepos) {
    pathByRequired.set(m.required, extractRepoPath(m.local?.remoteUrl) ?? extractRepoPath(m.required))
  }

  // 先數總共要查幾個 branch（跨所有 ticket / repo），讓使用者對耗時與進度有底
  let total = 0
  for (const ticket of analysis.perTicket) for (const repo of ticket.repos) total += repo.branches.length
  onProgress('mr-start', { total, tickets: analysis.perTicket.length })

  let started = 0
  let done = 0
  for (const ticket of analysis.perTicket) {
    for (const repo of ticket.repos) {
      const projectPath = pathByRequired.get(repo.required)

      await Promise.all(
        repo.branches.map(async (b) => {
          // 一律用 branch 名查 MR（不看 hasRemote）：
          // remote branch 被刪但曾 push+merge 的，GitLab 仍查得到；純本地未 push 的會回空陣列。
          const n = ++started
          const startedAt = Date.now()
          // 先發 start：萬一某個 branch 卡住（GitLab 沒回應），最後一筆沒有對應 done 的就是元兇
          onProgress('mr-item-start', { n, total, ticket: ticket.key, repo: repo.required, branch: b.name })
          try {
            const mrs = await gitlab.getMergeRequestsBySourceBranch(projectPath, b.name)
            if (debug) debug.mrQueries.push({ repo: repo.required, projectPath, sourceBranch: b.name, count: mrs.length, mrs })
            const mapped = mrs.map(mapMr)
            // opened / merged 都補查未解決討論數 + 核准數（merged 也可能殘留沒處理的 comments）
            await Promise.all(
              mapped.map(async (mr) => {
                if (mr.state !== 'opened' && mr.state !== 'merged') return
                try {
                  const discussions = await gitlab.getMergeRequestDiscussions(projectPath, mr.iid)
                  mr.unresolvedCount = countUnresolvedDiscussions(discussions)
                } catch {
                  mr.unresolvedCount = null // 討論查詢失敗
                }
                try {
                  const approvals = await gitlab.getMergeRequestApprovals(projectPath, mr.iid)
                  mr.approvedCount = Array.isArray(approvals?.approved_by) ? approvals.approved_by.length : null
                  mr.approvalsRequired = approvals?.approvals_required ?? null
                } catch {
                  mr.approvedCount = null // 核准查詢失敗
                }
              })
            )
            b.mergeRequests = mapped
            onProgress('mr-item-done', { n, total, done: ++done, ticket: ticket.key, repo: repo.required, branch: b.name, mrCount: mapped.length, ms: Date.now() - startedAt })
          } catch (err) {
            b.mergeRequests = null
            repo.gitlabError = shortErr(err)
            onProgress('mr-item-done', { n, total, done: ++done, ticket: ticket.key, repo: repo.required, branch: b.name, error: shortErr(err), ms: Date.now() - startedAt })
          }
        })
      )
    }
  }

  return analysis
}

/**
 * 用 jira key 到各 repo 搜尋「已 merged」的 MR（title/description 含 key）。
 * 給短路完成、但 branch 已刪查不到 MR 的 ticket 補上 merged MR 資訊。
 */
export async function findMergedMrsByKey(config, matchedRepos, key, { debug = null } = {}) {
  const gitlab = new GitlabClient(config.gitlab)
  const lower = key.toLowerCase()
  const seen = new Set()
  const found = []
  for (const m of matchedRepos) {
    const projectPath = extractRepoPath(m.local?.remoteUrl) ?? extractRepoPath(m.required)
    try {
      const mrs = await gitlab.searchMergedMergeRequests(projectPath, key)
      if (debug) debug.mrQueries.push({ repo: m.required, projectPath, searchKey: key, state: 'merged', count: mrs.length, mrs })
      for (const mr of mrs) {
        const hay = `${mr.source_branch ?? ''} ${mr.title ?? ''}`.toLowerCase()
        if (hay.includes(lower) && !seen.has(mr.web_url)) {
          seen.add(mr.web_url)
          found.push(mapMr(mr))
        }
      }
    } catch {
      // 單一 repo 搜尋失敗就略過
    }
  }
  return found
}
