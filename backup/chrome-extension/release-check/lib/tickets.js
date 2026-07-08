import { JiraClient } from './jira.js'
import { selectVersionsInWindow } from './fixVersion.js'

// JQL 特殊字元轉義（用在雙引號字串裡）
function escapeJqlValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function buildJql(projects, versionNames, assigneeAccountId) {
  const projectList = projects.map((p) => `"${escapeJqlValue(p)}"`).join(', ')
  const versionList = versionNames.map((n) => `"${escapeJqlValue(n)}"`).join(', ')
  const clauses = [`project in (${projectList})`, `fixVersion in (${versionList})`]
  if (assigneeAccountId) clauses.push(`assignee = "${escapeJqlValue(assigneeAccountId)}"`)
  return clauses.join(' AND ') + ' ORDER BY key ASC'
}

// 依名字或 email 搜尋 Jira 使用者，回傳符合的清單（用於驗證 assignee 是否存在）
export async function searchAssignee(config, query) {
  const jira = new JiraClient(config.jira)
  return jira.searchUsers(query)
}

function mapIssue(issue) {
  return {
    key: issue.key,
    summary: issue.fields?.summary ?? '',
    status: issue.fields?.status?.name ?? '未知',
    type: issue.fields?.issuetype?.name ?? null,
    fixVersions: (issue.fields?.fixVersions ?? []).map((v) => v.name),
  }
}

/**
 * 依「今天 + daysAhead」挑出目標 fix version，再撈出這些版本底下的所有 ticket（不過濾狀態）。
 * 回傳 { versions, tickets, jql }。
 */
export async function fetchTargetTickets(config, { daysAhead, today = new Date(), assigneeAccountId = null } = {}) {
  const jira = new JiraClient(config.jira)
  const customRegex = config.fixVersionMatch?.dateTokenRegex ?? null
  const effectiveDaysAhead = daysAhead ?? config.fixVersionMatch?.daysAhead ?? 30

  // 跨專案收集落在時間窗內的版本
  const versions = []
  for (const project of config.jira.projects) {
    const projectVersions = await jira.getProjectVersions(project)
    const inWindow = selectVersionsInWindow(projectVersions, { today, daysAhead: effectiveDaysAhead, customRegex })
    for (const v of inWindow) versions.push({ project, name: v.name, releaseDate: v.releaseDate })
  }

  if (versions.length === 0) {
    return { versions: [], tickets: [], jql: null, daysAhead: effectiveDaysAhead }
  }

  const versionNames = [...new Set(versions.map((v) => v.name))]
  const jql = buildJql(config.jira.projects, versionNames, assigneeAccountId)
  const issues = await jira.searchIssues(jql)
  const tickets = issues.map(mapIssue)

  return { versions, tickets, jql, daysAhead: effectiveDaysAhead }
}
