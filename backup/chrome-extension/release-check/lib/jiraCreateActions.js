// C — Jira 批量開「關聯單」的 engine 函式（不含互動；回 { ok, ... }）
import { toErrorResult } from './writeCommon.js'

// 純文字 → Jira ADF（description 用）。每行一個段落。
export function textToAdf(text) {
  const lines = String(text ?? '').split('\n')
  return {
    type: 'doc',
    version: 1,
    content: lines.map((line) =>
      line.trim() === '' ? { type: 'paragraph', content: [] } : { type: 'paragraph', content: [{ type: 'text', text: line }] }
    ),
  }
}

/**
 * 建一張獨立 issue，並用 link 綁到母單。
 * childIsInward：true = 新單是 inwardIssue（當 link type 的 inward 文字是「is child of」時）。
 * 回 { ok:true, issue:{ key, url }, link:{ ok } } | { ok:false, error, status }（issue 沒建成才 ok:false）
 */
export async function createLinkedChildIssue(jira, params = {}) {
  const {
    parentKey,
    projectKey,
    issueType,
    summary,
    descriptionAdf = null,
    assigneeAccountId = null,
    labels = [],
    linkTypeName,
    childIsInward = true,
  } = params

  if (!parentKey || !projectKey || !issueType || !summary || !linkTypeName) {
    return { ok: false, error: 'createLinkedChildIssue 缺少必要參數（parentKey / projectKey / issueType / summary / linkTypeName）' }
  }

  const fields = { project: { key: projectKey }, issuetype: { name: issueType }, summary }
  if (descriptionAdf) fields.description = descriptionAdf
  if (assigneeAccountId) fields.assignee = { accountId: assigneeAccountId }
  if (labels.length) fields.labels = labels

  let issue
  try {
    issue = await jira.createIssue(fields)
  } catch (err) {
    return toErrorResult(err)
  }

  const url = `${jira.baseUrl}/browse/${issue.key}`
  // 建 link（issue 已建成，link 失敗只回報，不讓整張變失敗）
  let link = { ok: true }
  try {
    const inwardKey = childIsInward ? issue.key : parentKey
    const outwardKey = childIsInward ? parentKey : issue.key
    await jira.createIssueLink({ typeName: linkTypeName, inwardKey, outwardKey })
  } catch (err) {
    link = toErrorResult(err)
  }
  return { ok: true, issue: { key: issue.key, url }, link }
}

/**
 * 對多個母單各建一張關聯單；逐筆回報、部分失敗不中斷。
 * fields：createLinkedChildIssue 除 parentKey 外的固定欄位。summary 可含 {parent} 佔位符。
 * 回 { ok:true, results:[{ parentKey, ok, issueKey?, url?, linkOk?, error? }] }
 */
export async function createLinkedChildIssues(jira, { parents = [], fields = {} } = {}) {
  const results = []
  for (const parentKey of parents) {
    const summary = String(fields.summary ?? '').split('{parent}').join(parentKey)
    const r = await createLinkedChildIssue(jira, { ...fields, summary, parentKey })
    if (r.ok) {
      results.push({ parentKey, ok: true, issueKey: r.issue.key, url: r.issue.url, linkOk: r.link.ok, error: r.link.ok ? undefined : r.link.error })
    } else {
      results.push({ parentKey, ok: false, error: r.error })
    }
  }
  return { ok: true, results }
}
