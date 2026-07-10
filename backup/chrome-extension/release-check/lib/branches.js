import { git } from './repos.js'

const REMOTE = 'origin'

function shortErr(err) {
  return (err?.stderr || err?.message || String(err)).split('\n')[0].slice(0, 200)
}

// 解析 full refname 成 { full, short, kind, remote }
function parseRef(full) {
  if (full.startsWith('refs/heads/')) {
    return { full, short: full.slice('refs/heads/'.length), kind: 'local' }
  }
  if (full.startsWith('refs/remotes/')) {
    const rest = full.slice('refs/remotes/'.length) // e.g. origin/feature/X
    const slash = rest.indexOf('/')
    if (slash < 0) return null
    return { full, short: rest.slice(slash + 1), kind: 'remote', remote: rest.slice(0, slash) }
  }
  return null
}

// 列出 repo 的所有本地 + 遠端分支 ref
async function listBranchRefs(repoPath) {
  const out = await git(repoPath, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'])
  if (!out) return []
  return out
    .split('\n')
    .map((line) => parseRef(line.trim()))
    .filter((r) => r && r.short !== 'HEAD')
}

// 找出名稱含 ticket key（不拘位置、忽略大小寫）的分支，local / remote 合併成同一個邏輯分支
function matchBranches(refs, key) {
  const lower = key.toLowerCase()
  const map = new Map()
  for (const r of refs) {
    if (!r.short.toLowerCase().includes(lower)) continue
    const entry = map.get(r.short) ?? { short: r.short, localRef: null, remoteRef: null }
    if (r.kind === 'local') entry.localRef = r.full
    else if (r.kind === 'remote' && r.remote === REMOTE) entry.remoteRef = r.full
    map.set(r.short, entry)
  }
  return [...map.values()]
}

// 這個 commit 被哪些分支包含（用來判斷是否已合併進 target 分支）
async function listContaining(repoPath, tip) {
  try {
    const out = await git(repoPath, ['branch', '--all', '--contains', tip, '--format=%(refname)'])
    if (!out) return new Set()
    return new Set(out.split('\n').map((s) => s.trim()).filter(Boolean))
  } catch {
    return new Set()
  }
}

// local 相對 remote 的 ahead（未 push）/ behind（落後）commit 數
async function aheadBehind(repoPath, localRef, remoteRef) {
  try {
    const out = await git(repoPath, ['rev-list', '--left-right', '--count', `${localRef}...${remoteRef}`])
    const [ahead, behind] = out.split(/\s+/).map((n) => Number(n) || 0)
    return { ahead, behind }
  } catch {
    return { ahead: 0, behind: 0 }
  }
}

async function analyzeBranch(repoPath, entry, targetBranches) {
  const tip = entry.remoteRef ?? entry.localRef
  const containing = await listContaining(repoPath, tip)
  // 只認 remote：以 server 上的 origin/<target> 是否包含此 commit 為準（發版語意）
  const mergedInto = targetBranches.filter((t) => containing.has(`refs/remotes/${REMOTE}/${t}`))

  const hasLocal = !!entry.localRef
  const hasRemote = !!entry.remoteRef
  let pushed = true
  let ahead = 0
  let behind = 0

  if (hasLocal && hasRemote) {
    const ab = await aheadBehind(repoPath, entry.localRef, entry.remoteRef)
    ahead = ab.ahead
    behind = ab.behind
    pushed = ahead === 0
  } else if (hasLocal && !hasRemote) {
    pushed = false
    ahead = null
    behind = null
  }

  return { name: entry.short, hasLocal, hasRemote, pushed, ahead, behind, mergedInto }
}

/**
 * 對每個（已對應到本地的）repo：可選 git fetch → 針對每張 ticket 找對應分支並分析合併/未 push 狀態。
 * matchedRepos：checkRepoCoverage() 回傳的 matched（含 required 與 local.path）。
 */
export async function analyzeTicketsAcrossRepos(matchedRepos, tickets, targetBranches, { doFetch = true } = {}) {
  // 每個 repo 先 fetch 一次並讀出所有 ref
  const repoCtx = []
  for (const m of matchedRepos) {
    const ctx = { required: m.required, path: m.local.path, fetchError: null, refs: [], missingTargets: [] }
    if (doFetch) {
      try {
        await git(ctx.path, ['fetch', '--all', '--prune'], { timeout: 60000 })
      } catch (err) {
        ctx.fetchError = shortErr(err)
      }
    }
    try {
      ctx.refs = await listBranchRefs(ctx.path)
    } catch (err) {
      ctx.fetchError = ctx.fetchError ?? shortErr(err)
    }
    const remoteShorts = new Set(ctx.refs.filter((r) => r.kind === 'remote' && r.remote === REMOTE).map((r) => r.short))
    ctx.missingTargets = targetBranches.filter((t) => !remoteShorts.has(t))
    repoCtx.push(ctx)
  }

  const perTicket = []
  for (const t of tickets) {
    const repos = []
    for (const ctx of repoCtx) {
      const entries = matchBranches(ctx.refs, t.key)
      const branches = await Promise.all(entries.map((e) => analyzeBranch(ctx.path, e, targetBranches)))
      repos.push({ required: ctx.required, fetchError: ctx.fetchError, missingTargets: ctx.missingTargets, branches })
    }
    perTicket.push({ key: t.key, summary: t.summary, repos })
  }

  return { perTicket, targetBranches }
}
