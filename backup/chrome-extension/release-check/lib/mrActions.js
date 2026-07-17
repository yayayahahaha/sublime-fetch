// A — 開 MR 的 engine 函式（不含任何互動；回 { ok, ... }）
import { toErrorResult } from './writeCommon.js'

const DEFAULT_DESCRIPTION_TEMPLATE = [
  '## Jira',
  '{jiraUrl}',
  '',
  '## 說明',
  '（TODO）',
  '',
  '## 測試',
  '- [ ] ',
].join('\n')

/**
 * 用 ticket + template 組出 MR 的 title / description（只組欄位，不建立）。
 * template 可含 {key} {summary} {jiraUrl} 佔位符；沒給就用預設。
 */
export function buildMrFields({ key, summary, jiraUrl, template } = {}) {
  const title = summary ? `${key} ${summary}` : (key ?? '')
  const tpl = template ?? DEFAULT_DESCRIPTION_TEMPLATE
  const description = tpl
    .split('{key}').join(key ?? '')
    .split('{summary}').join(summary ?? '')
    .split('{jiraUrl}').join(jiraUrl ?? '')
  return { title, description }
}

/**
 * 建立 MR。
 * gitlab：GitlabClient；params 見下。
 * 回 { ok:true, mr:{ iid, webUrl, title, targetBranch } } | { ok:false, error, status }
 */
export async function createMergeRequest(gitlab, params = {}) {
  const {
    projectPath,
    sourceBranch,
    targetBranch,
    title,
    description = '',
    assigneeIds = [],
    reviewerIds = [],
    labels = [],
    removeSourceBranch = true,
    squash = false,
  } = params

  if (!projectPath || !sourceBranch || !targetBranch || !title) {
    return { ok: false, error: 'createMergeRequest 缺少必要參數（projectPath / sourceBranch / targetBranch / title）' }
  }

  const scope = await gitlab.ensureWriteScope()
  if (!scope.ok) return scope

  try {
    const id = encodeURIComponent(projectPath)
    const mr = await gitlab.request(`/projects/${id}/merge_requests`, {
      method: 'POST',
      body: {
        source_branch: sourceBranch,
        target_branch: targetBranch,
        title,
        description,
        assignee_ids: assigneeIds,
        reviewer_ids: reviewerIds,
        labels: labels.join(','),
        remove_source_branch: removeSourceBranch,
        squash,
      },
    })
    return { ok: true, mr: { iid: mr.iid, webUrl: mr.web_url, title: mr.title, targetBranch: mr.target_branch } }
  } catch (err) {
    return toErrorResult(err)
  }
}
