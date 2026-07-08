// Jira Cloud REST API v3 client（btse.atlassian.net）
// 認證方式：email + API token 的 Basic Auth（Cloud 不是用 PAT）

export class JiraClient {
  constructor({ baseUrl, email, apiToken }) {
    this.baseUrl = baseUrl
    this.authHeader = 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64')
  }

  async request(pathname, { method = 'GET', query, body } = {}) {
    const url = new URL(this.baseUrl + pathname)
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value != null) url.searchParams.set(key, value)
      }
    }
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const err = new Error(`Jira API ${method} ${pathname} 失敗：${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ''}`)
      err.status = res.status
      throw err
    }
    return res.json()
  }

  // 驗證認證是否有效，回傳目前登入者資訊
  async getMyself() {
    return this.request('/rest/api/3/myself')
  }

  // 取得某專案的所有 version（含名稱、released、日期等）
  async getProjectVersions(projectKey) {
    return this.request(`/rest/api/3/project/${encodeURIComponent(projectKey)}/versions`)
  }

  // 依名字或 email 搜尋使用者（用來驗證 assignee 是否存在並取得 accountId）
  async searchUsers(query, maxResults = 50) {
    return this.request('/rest/api/3/user/search', { query: { query, maxResults } })
  }

  /**
   * 用 JQL 搜尋 issue，自動分頁把全部撈完。
   * 使用 Jira Cloud 現行的 /search/jql（token-based 分頁）。
   */
  async searchIssues(jql, fields = ['summary', 'status', 'issuetype', 'fixVersions']) {
    const issues = []
    let nextPageToken
    do {
      const data = await this.request('/rest/api/3/search/jql', {
        query: { jql, maxResults: 100, fields: fields.join(','), nextPageToken },
      })
      issues.push(...(data.issues ?? []))
      nextPageToken = data.nextPageToken
    } while (nextPageToken)
    return issues
  }
}
