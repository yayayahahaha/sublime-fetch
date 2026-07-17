// 開 MR 用的純函式：由 branch 名生成 PR 標題、猜 target 分支、組 GitLab「新 MR」預填 URL。
// 沿用舊 script 的邏輯，並把寫死的部分（jira key、target override、whitelabel 清單）改成可傳入。
import fs from 'fs'
import path from 'path'

// 預設 whitelabel 清單（用來把 branch 名裡的 brand 段落抓成 [btse] 這種標籤）。可由 config 覆寫。
export const DEFAULT_WHITELABELS = [
  'btse', 'altex', 'autotrader', 'b2z', 'bestpay', 'binoex', 'bitkub', 'bitmarkets',
  'bitmarketsalpha', 'bitqik', 'btseag', 'btsegi', 'btseuab', 'bullstreet', 'coinwise',
  'cryptomarket', 'exchangedemo', 'fedhabit', 'interpay', 'lmex', 'nvx', 'obot', 'paradise',
  'pixbit', 'testnet', 'traiex', 'transexchange', 'walletdemo',
]

// MR 描述樣板（沿用舊 script）。
export const DESCRIPTION_TEMPLATE = '#### 背景\n\n\n#### 怎麼處理\n\n\n#### 其他\n掛上 draft 避免誤觸'

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 掃某個 repo 根目錄的 src/brand-*／取 brand 名（排除裸的 src/brand）。
 * 掃不到（沒有 src 或沒有 brand-* 目錄）回空陣列，讓呼叫端決定退回內建清單。
 */
export function discoverBrandsFromRepo(repoRoot, { srcDir = 'src', prefix = 'brand-' } = {}) {
  const dir = path.join(repoRoot, srcDir)
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isDirectory() && e.name.startsWith(prefix) && e.name.length > prefix.length)
    .map((e) => e.name.slice(prefix.length))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

/**
 * 由 branch 名生成 PR 標題。
 *   PLAT-1234_FE-btse-fix-something  →  PLAT-1234 [FE][btse] fix something
 * jiraKeys：專案 key 清單（例如 ['PLAT']），用來抓開頭的 <KEY>-<num>；空則用 [A-Z]+。
 * whitelabels：branch 名中要抓成 [xxx] 標籤的 brand 段落。
 */
export function branchNameToPrTitle(branchName, { jiraKeys = [], whitelabels = DEFAULT_WHITELABELS } = {}) {
  const keyAlt = jiraKeys.length ? `(?:${jiraKeys.map(escapeRegex).join('|')})` : '[A-Z]+'
  const m = String(branchName).match(new RegExp(`(${keyAlt}-\\d+)_(.+)`))
  const [, num, originalName] = m || ['', '', '']

  const wlSet = new Set(whitelabels.map((w) => w.toLowerCase()))
  const { keys, last } = (originalName || branchName).split('-').reduce(
    (acc, str) => {
      if (str === 'FE' || wlSet.has(str.toLowerCase())) acc.keys.push(str)
      else acc.last.push(str)
      return acc
    },
    { keys: [], last: [] }
  )

  const keysText = keys.map((k) => `[${k}]`).join('')
  const titleText = last.join(' ')
  return `${num} ${keysText} ${titleText}`.replace(/\s+/g, ' ').trim()
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
