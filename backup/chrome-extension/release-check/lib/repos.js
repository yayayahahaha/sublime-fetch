import fs from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// 在指定目錄跑 git 指令，回傳 stdout（trim 過）。
// GIT_TERMINAL_PROMPT=0 讓需要認證的操作（如 fetch）直接失敗而非卡在互動提示。
export async function git(cwd, args, { timeout } = {}) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  return stdout.trim()
}

/**
 * 從各種 git remote URL 取出 `namespace/project`（保留原始大小寫、去掉 .git）。
 *   git@gitlab.example.com:group/sub/repo.git  -> group/sub/repo
 *   https://gitlab.example.com/group/repo.git   -> group/repo
 *   ssh://git@host:22/group/repo.git            -> group/repo
 * GitLab API 的 project id 需要真實大小寫的路徑，用這個。
 */
export function extractRepoPath(input) {
  if (!input) return null
  let s = String(input).trim()

  s = s.replace(/\.git$/i, '')

  // scp-like: git@host:group/repo
  const scpMatch = s.match(/^[^/@]+@[^/:]+:(.+)$/)
  if (scpMatch) {
    s = scpMatch[1]
  } else if (/^[a-z]+:\/\//i.test(s)) {
    // 有 protocol 的 URL，取 host 之後的 path
    try {
      s = new URL(s).pathname
    } catch {
      // 解析失敗就原樣往下走
    }
  }

  return s.replace(/^\/+/, '').replace(/\/+$/, '')
}

/**
 * 把 repo 來源正規化成小寫的 identity，用於 requiredRepos 與本地 remote 的比對。
 */
export function normalizeRepoIdentity(input) {
  const p = extractRepoPath(input)
  return p ? p.toLowerCase() : null
}

// 檢查某個路徑是不是 git repo，並取出 origin remote 的 identity
async function inspectLocalRepo(repoPath) {
  const result = { path: repoPath, exists: false, isGitRepo: false, remoteUrl: null, identity: null, error: null }

  if (!fs.existsSync(repoPath)) {
    result.error = '路徑不存在'
    return result
  }
  result.exists = true

  try {
    await git(repoPath, ['rev-parse', '--is-inside-work-tree'])
    result.isGitRepo = true
  } catch {
    result.error = '不是 git repo'
    return result
  }

  try {
    result.remoteUrl = await git(repoPath, ['remote', 'get-url', 'origin'])
    result.identity = normalizeRepoIdentity(result.remoteUrl)
  } catch {
    result.error = '沒有 origin remote'
  }

  return result
}

/**
 * 檢查 localRepoPaths 是否涵蓋了所有 requiredRepos。
 * 回傳 { locals, matched, missing, unmatchedLocals, ok }
 */
export async function checkRepoCoverage(requiredRepos, localRepoPaths) {
  const locals = await Promise.all(localRepoPaths.map(inspectLocalRepo))

  // 建立 identity -> local 的對照
  const localByIdentity = new Map()
  for (const local of locals) {
    if (local.identity) localByIdentity.set(local.identity, local)
  }

  const matched = []
  const missing = []
  for (const required of requiredRepos) {
    const identity = normalizeRepoIdentity(required)
    const local = localByIdentity.get(identity)
    if (local) {
      matched.push({ required, identity, local })
    } else {
      missing.push({ required, identity })
    }
  }

  const matchedIdentities = new Set(matched.map((m) => m.identity))
  const unmatchedLocals = locals.filter((l) => !l.identity || !matchedIdentities.has(l.identity))

  return {
    locals,
    matched,
    missing,
    unmatchedLocals,
    ok: missing.length === 0,
  }
}
