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
export async function enrichWithMergeRequests(analysis, matchedRepos, config) {
  const gitlab = new GitlabClient(config.gitlab)

  // required -> GitLab project 路徑（保留大小寫，優先用本地 origin remote 的真實路徑）
  const pathByRequired = new Map()
  for (const m of matchedRepos) {
    pathByRequired.set(m.required, extractRepoPath(m.local?.remoteUrl) ?? extractRepoPath(m.required))
  }

  for (const ticket of analysis.perTicket) {
    for (const repo of ticket.repos) {
      const projectPath = pathByRequired.get(repo.required)

      await Promise.all(
        repo.branches.map(async (b) => {
          if (!b.hasRemote) {
            b.mergeRequests = [] // 沒 push 就不可能有 MR
            return
          }
          try {
            const mrs = await gitlab.getMergeRequestsBySourceBranch(projectPath, b.name)
            const mapped = mrs.map(mapMr)
            // 只對還開著的 MR 數未解決討論（已 merged/closed 的討論狀態無意義）
            await Promise.all(
              mapped.map(async (mr) => {
                if (mr.state !== 'opened') return
                try {
                  const discussions = await gitlab.getMergeRequestDiscussions(projectPath, mr.iid)
                  mr.unresolvedCount = countUnresolvedDiscussions(discussions)
                } catch {
                  mr.unresolvedCount = null // 討論查詢失敗
                }
              })
            )
            b.mergeRequests = mapped
          } catch (err) {
            b.mergeRequests = null
            repo.gitlabError = shortErr(err)
          }
        })
      )
    }
  }

  return analysis
}
