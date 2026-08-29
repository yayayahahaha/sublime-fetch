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
 * 依時間窗（往後 N 天，或明確的日期區間）挑出目標 fix version，再撈出這些版本底下的所有 ticket（不過濾狀態）。
 * window：{ kind: 'days', daysAhead } 或 { kind: 'range', start, end }；未給時退回 daysAhead / config 預設。
 * 回傳 { versions, tickets, jql, window }。
 */
export async function fetchTargetTickets(config, { daysAhead, window = null, today = new Date(), assigneeAccountId = null, debug = null } = {}) {
  const jira = new JiraClient(config.jira)
  const customRegex = config.fixVersionMatch?.dateTokenRegex ?? null
  const fallbackDays = config.fixVersionMatch?.daysAhead ?? 30
  const win = window ?? { kind: 'days', daysAhead: daysAhead ?? fallbackDays }

  // 跨專案收集落在時間窗內的版本
  const versions = []
  for (const project of config.jira.projects) {
    const projectVersions = await jira.getProjectVersions(project)
    if (debug) debug.jira.versions[project] = projectVersions
    const inWindow = selectVersionsInWindow(projectVersions, { today, customRegex, window: win })
    for (const v of inWindow) versions.push({ project, name: v.name, releaseDate: v.releaseDate })
  }

  if (versions.length === 0) {
    return { versions: [], tickets: [], jql: null, window: win }
  }

  const versionNames = [...new Set(versions.map((v) => v.name))]
  const jql = buildJql(config.jira.projects, versionNames, assigneeAccountId)
  const issues = await jira.searchIssues(jql)
  if (debug) {
    debug.jira.jql = jql
    debug.jira.issues = issues
  }
  const tickets = issues.map(mapIssue)

  return { versions, tickets, jql, window: win }
}
