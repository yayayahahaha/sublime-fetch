// GitLab REST API v4 client
// 認證方式：Personal Access Token（scope 需含 read_api）

export class GitlabClient {
  constructor({ baseUrl, token }) {
    this.baseUrl = baseUrl
    this.token = token
  }

  async _fetch(pathname, { method = 'GET', query, body } = {}) {
    const url = new URL(this.baseUrl + '/api/v4' + pathname)
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value != null) url.searchParams.set(key, value)
      }
    }
    const res = await fetch(url, {
      method,
      headers: {
        'PRIVATE-TOKEN': this.token,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const err = new Error(`GitLab API ${method} ${pathname} 失敗：${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ''}`)
      err.status = res.status
      throw err
    }
    return res
  }

  async request(pathname, opts) {
    const res = await this._fetch(pathname, opts)
    const text = await res.text()
    return text ? JSON.parse(text) : null // 容忍空 body
  }

  // 分頁把某個 list endpoint 全部撈完（用 x-next-page header）
  async requestPaged(pathname, { query } = {}) {
    const results = []
    let page = 1
    for (;;) {
      const res = await this._fetch(pathname, { query: { ...query, per_page: 100, page } })
      const data = await res.json()
      if (Array.isArray(data)) results.push(...data)
      const next = res.headers.get('x-next-page')
      if (!next) break
      page = Number(next)
    }
    return results
  }

  // 驗證 token 是否有效，回傳目前使用者
  async getCurrentUser() {
    return this.request('/user')
  }

  // 目前使用者在該 repo 的最高 access level（Developer=30 / Maintainer=40 …）。查不到回 null。
  async getProjectAccessLevel(projectPath) {
    const id = encodeURIComponent(projectPath)
    const p = await this.request(`/projects/${id}`)
    const proj = p?.permissions?.project_access?.access_level
    const grp = p?.permissions?.group_access?.access_level
    const levels = [proj, grp].filter((x) => typeof x === 'number')
    return levels.length ? Math.max(...levels) : null
  }

  // 取單一分支資訊；分支不存在時 throw（err.status === 404）
  async getBranch(projectPath, branch) {
    const id = encodeURIComponent(projectPath)
    const b = encodeURIComponent(branch)
    return this.request(`/projects/${id}/repository/branches/${b}`)
  }

  // 取某 ref 下某檔案的原始內容（text）
  async getFileRaw(projectPath, filePath, ref) {
    const id = encodeURIComponent(projectPath)
    const f = encodeURIComponent(filePath)
    const res = await this._fetch(`/projects/${id}/repository/files/${f}/raw`, { query: { ref } })
    return res.text()
  }

  // 依關鍵字搜尋使用者（給 assignee/reviewer 的查找+select 用），回 [{id, username, name}]
  async searchUsers(query, perPage = 20) {
    const users = await this.request('/users', { query: { search: query, per_page: perPage } })
    return (Array.isArray(users) ? users : []).map((u) => ({ id: u.id, username: u.username, name: u.name }))
  }

  // 寫入前檢查 token scope 是否含 api（read_api 只能讀）。無法確認 scope 時放行（改由實際呼叫的 403 把關）。
  async ensureWriteScope() {
    let scopes
    try {
      scopes = await this.getTokenScopes()
    } catch (err) {
      return { ok: false, error: `無法確認 GitLab token scope：${err.message}` }
    }
    if (scopes == null) return { ok: true, scopes: null } // 舊版查不到 → 放行
    if (scopes.includes('api')) return { ok: true, scopes }
    return { ok: false, error: `GitLab token 缺少 api scope（目前：${scopes.join(', ') || '無'}）；寫入動作需要 api scope，請改用有 api scope 的 token`, scopes }
  }

  // 查某 repo 中以 sourceBranch 為來源分支的所有 MR（各種狀態），回傳 target 與狀態。
  async getMergeRequestsBySourceBranch(projectPath, sourceBranch) {
    const id = encodeURIComponent(projectPath)
    return this.request(`/projects/${id}/merge_requests`, {
      query: { source_branch: sourceBranch, state: 'all', per_page: 100 },
    })
  }

  // 以關鍵字（如 jira key）搜尋已 merged 的 MR（在 title/description 內搜尋）。
  // 用於 branch 已刪、無法用 source_branch 查到 MR 的情況。
  async searchMergedMergeRequests(projectPath, search) {
    const id = encodeURIComponent(projectPath)
    return this.request(`/projects/${id}/merge_requests`, { query: { search, state: 'merged', per_page: 50 } })
  }

  // 取某 pipeline 的 bridge（trigger）jobs，用來找 downstream 子 pipeline。
  async getPipelineBridges(projectPath, pipelineId) {
    const id = encodeURIComponent(projectPath)
    return this.requestPaged(`/projects/${id}/pipelines/${pipelineId}/bridges`)
  }

  // 取得某 MR 的所有討論串（分頁撈完），用來數未解決的討論。
  async getMergeRequestDiscussions(projectPath, iid) {
    const id = encodeURIComponent(projectPath)
    return this.requestPaged(`/projects/${id}/merge_requests/${iid}/discussions`)
  }

  // 取得某 MR 的核准資訊（approved_by / approvals_required）。
  async getMergeRequestApprovals(projectPath, iid) {
    const id = encodeURIComponent(projectPath)
    return this.request(`/projects/${id}/merge_requests/${iid}/approvals`)
  }

  // 取得目前 token 的資訊（含 scopes）。舊版 GitLab 可能沒有這個 endpoint。
  async getTokenScopes() {
    try {
      const info = await this.request('/personal_access_tokens/self')
      return Array.isArray(info.scopes) ? info.scopes : null
    } catch (err) {
      // endpoint 不存在（404）或無權限時，回傳 null 代表無法確認
      if (err.status === 404 || err.status === 401) return null
      throw err
    }
  }
}
