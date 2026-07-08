// GitLab REST API v4 client
// 認證方式：Personal Access Token（scope 需含 read_api）

export class GitlabClient {
  constructor({ baseUrl, token }) {
    this.baseUrl = baseUrl
    this.token = token
  }

  async _fetch(pathname, { method = 'GET', query } = {}) {
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
      },
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
    return res.json()
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

  // 查某 repo 中以 sourceBranch 為來源分支的所有 MR（各種狀態），回傳 target 與狀態。
  async getMergeRequestsBySourceBranch(projectPath, sourceBranch) {
    const id = encodeURIComponent(projectPath)
    return this.request(`/projects/${id}/merge_requests`, {
      query: { source_branch: sourceBranch, state: 'all', per_page: 100 },
    })
  }

  // 取得某 MR 的所有討論串（分頁撈完），用來數未解決的討論。
  async getMergeRequestDiscussions(projectPath, iid) {
    const id = encodeURIComponent(projectPath)
    return this.requestPaged(`/projects/${id}/merge_requests/${iid}/discussions`)
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
