import { JiraClient } from './jira.js'
import { GitlabClient } from './gitlab.js'
import { checkRepoCoverage } from './repos.js'

async function checkJira(config) {
  const check = { name: 'Jira 認證', ok: false, detail: '', hint: '' }
  try {
    const jira = new JiraClient(config.jira)
    const me = await jira.getMyself()
    check.ok = true
    check.detail = `以 ${me.displayName || me.emailAddress || config.jira.email} 身分登入 ${config.jira.baseUrl}`
  } catch (err) {
    check.detail = err.message
    if (err.status === 401 || err.status === 403) {
      check.hint = 'email 或 API token 無效／過期。請到 https://id.atlassian.com/manage-profile/security/api-tokens 重新產生 API token（注意 Cloud 用的是 email + API token，不是 PAT）'
    } else {
      check.hint = '確認 jira.baseUrl 是否正確（應為 https://btse.atlassian.net）'
    }
  }
  return check
}

async function checkGitlab(config) {
  const check = { name: 'GitLab 認證', ok: false, detail: '', hint: '' }
  try {
    const gitlab = new GitlabClient(config.gitlab)
    const user = await gitlab.getCurrentUser()
    check.ok = true
    check.detail = `以 ${user.username} 身分登入 ${config.gitlab.baseUrl}`

    const scopes = await gitlab.getTokenScopes()
    if (scopes && !scopes.includes('read_api') && !scopes.includes('api')) {
      check.ok = false
      check.detail += `；但 token scope 為 [${scopes.join(', ')}]，缺少 read_api`
      check.hint = '請重新產生 token 並勾選 read_api scope（查 Merge Request 需要）'
    } else if (scopes) {
      check.detail += `；scope: [${scopes.join(', ')}]`
    } else {
      check.detail += '；（此 GitLab 版本無法自動確認 scope，請自行確認含 read_api）'
    }
  } catch (err) {
    check.detail = err.message
    if (err.status === 401 || err.status === 403) {
      check.hint = 'token 無效／過期。請重新產生 Personal Access Token 並勾選 read_api scope'
    } else {
      check.hint = '確認 gitlab.baseUrl 是否正確'
    }
  }
  return check
}

async function checkRepos(config) {
  const check = { name: '本地 repo 涵蓋', ok: false, detail: '', hint: '', coverage: null }
  try {
    const coverage = await checkRepoCoverage(config.requiredRepos, config.localRepoPaths)
    check.coverage = coverage
    check.ok = coverage.ok
    check.detail = `必檢 ${config.requiredRepos.length} 個 repo，本地路徑 ${config.localRepoPaths.length} 個，已對應 ${coverage.matched.length} 個`
    if (!coverage.ok) {
      check.hint = '請把缺少的 repo clone 到本機，並把路徑加進 config 的 localRepoPaths'
    }
  } catch (err) {
    check.detail = err.message
  }
  return check
}

export async function runPreflight(config) {
  const checks = await Promise.all([checkJira(config), checkGitlab(config), checkRepos(config)])
  return { checks, ok: checks.every((c) => c.ok) }
}
