// 開 MR 用的純函式：由 branch 名生成 PR 標題、猜 target 分支、組 GitLab「新 MR」預填 URL。

// MR 描述樣板（沿用舊 script）。
export const DESCRIPTION_TEMPLATE = '#### 背景\n\n\n#### 怎麼處理\n\n\n#### 其他\n掛上 draft 避免誤觸'

// branch 名開頭可被抓成 [tag] 的「範圍」標籤。只認這幾個（brand 清單比對太不準，已不參與）。
// 比對忽略大小寫（Web / WEB / web 都算）；輸出用這裡的正規寫法，順序也依此陣列（一定 [FE] 在 [Web] 前）。
// 要加新的（例如 BE）就往這裡塞。
export const SCOPE_TAGS = ['FE', 'Web']

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 由 branch 名生成 PR 標題。
 *   flyc/PLAT-37462-Web-FE-BTSE-ID-KWAI  →  [FE][Web] PLAT-37462 BTSE ID KWAI
 * 規則：
 *  1. 去掉「作者/」前綴（flyc/…）。
 *  2. 抓開頭的 <KEY>-<num>（後面接 - 或 _ 都可），ticket key 以原形保留（PLAT-37462）。
 *  3. 從 ticket 後面「只取開頭連續的 scope tag（SCOPE_TAGS）」，遇到第一個非 tag 就停 →
 *     中間 / 後面剛好等於 tag 的字（例如描述裡的第二個 Web）不會被誤抓。
 *  4. tag 依 SCOPE_TAGS 的順序輸出，其餘段落原樣接成描述。
 * jiraKeys：專案 key 清單（例如 ['PLAT']），用來抓開頭的 <KEY>-<num>；空則用 [A-Z]+。
 */
export function branchNameToPrTitle(branchName, { jiraKeys = [] } = {}) {
  const raw = String(branchName)
  // 1. 去掉作者前綴（第一個 / 之前的東西，例如 flyc/）
  const noPrefix = raw.includes('/') ? raw.slice(raw.indexOf('/') + 1) : raw

  // 2. 抓 <KEY>-<num>，後面接 - 或 _ 都接受
  const keyAlt = jiraKeys.length ? `(?:${jiraKeys.map(escapeRegex).join('|')})` : '[A-Z]+'
  const m = noPrefix.match(new RegExp(`^(${keyAlt}-\\d+)[-_](.+)`))
  const ticket = m ? m[1] : ''
  const rest = m ? m[2] : noPrefix

  const segments = rest.split(/[-_]/).filter(Boolean)

  // 3. 從開頭連續抓 scope tag，遇到第一個非 tag 就停
  const canonical = new Map(SCOPE_TAGS.map((t) => [t.toLowerCase(), t]))
  const foundTags = new Set()
  let i = 0
  for (; i < segments.length; i++) {
    const hit = canonical.get(segments[i].toLowerCase())
    if (!hit) break
    foundTags.add(hit)
  }
  const descText = segments.slice(i).join(' ')

  // 4. tag 依 SCOPE_TAGS 定義順序輸出（FE 在 Web 前）
  const tagsText = SCOPE_TAGS.filter((t) => foundTags.has(t)).map((t) => `[${t}]`).join('')

  return `${tagsText} ${ticket} ${descText}`.replace(/\s+/g, ' ').trim()
}

/**
 * 猜 MR 的 target 分支。overrides：{ '<repo 或路徑結尾>': '<branch>' }，命中就用；否則預設 develop。
 * 例：{ 'btse-static-resource': 'master' }
 */
export function guessTargetBranch(repoPath, overrides = {}) {
  const path = String(repoPath ?? '')
  for (const [key, branch] of Object.entries(overrides)) {
    if (path === key || path.endsWith(`/${key}`) || path.endsWith(key)) return branch
  }
  return 'develop'
}

/**
 * 組 GitLab「新 MR」的預填 URL（開瀏覽器讓使用者最後送出）。
 * assigneeIds / labels 皆可多個。
 */
export function buildNewMrUrl(gitlabBaseUrl, repoPath, { sourceBranch, targetBranch, title, description, assigneeIds = [], labels = [] } = {}) {
  const params = new URLSearchParams()
  params.set('merge_request[source_branch]', sourceBranch)
  params.set('merge_request[target_branch]', targetBranch)
  if (title) params.set('merge_request[title]', title)

  // label 的 URL prefill 在各 GitLab 版本支援不一致，改用描述裡的 quick action：
  // `/label ~"名稱"` 會在建立 MR 時被執行並從描述中移除，最穩。
  let desc = description || ''
  if (labels.length) {
    const quick = '/label ' + labels.map((l) => `~"${l}"`).join(' ')
    desc = desc ? `${desc}\n\n${quick}` : quick
  }
  if (desc) params.set('merge_request[description]', desc)

  for (const id of assigneeIds) params.append('merge_request[assignee_ids][]', String(id))
  const base = String(gitlabBaseUrl).replace(/\/+$/, '')
  return `${base}/${repoPath}/-/merge_requests/new?${params.toString()}`
}
