// 寫入權限預檢 engine：操作前先確認 token 有沒有足夠權限，並區分「scope / 角色 / Jira 權限」哪種問題。
// 都是唯讀查詢；回 { ok, ... }，不互動。
import { toErrorResult } from './writeCommon.js'

const ACCESS_LABEL = { 5: 'Minimal', 10: 'Guest', 20: 'Reporter', 30: 'Developer', 40: 'Maintainer', 50: 'Owner' }

/**
 * GitLab 寫入預檢：token 有沒有 api scope + 每個 repo 角色是否 ≥ minAccessLevel（預設 Developer=30）。
 * 回 { ok, scope:{ ok, scopes?, error? }, projects:[{ path, ok, accessLevel, accessLabel?, error? }] }
 */
export async function checkGitlabWrite(gitlab, { projectPaths = [], minAccessLevel = 30 } = {}) {
  const scope = await gitlab.ensureWriteScope()

  const projects = []
  for (const path of projectPaths) {
    try {
      const level = await gitlab.getProjectAccessLevel(path)
      if (level == null) {
        projects.push({ path, ok: false, accessLevel: null, error: '查不到角色（可能非該 repo 成員 / 無權限）' })
      } else {
        projects.push({ path, ok: level >= minAccessLevel, accessLevel: level, accessLabel: ACCESS_LABEL[level] ?? String(level) })
      }
    } catch (err) {
      const e = toErrorResult(err)
      projects.push({ path, ok: false, accessLevel: null, error: e.error, status: e.status })
    }
  }

  return { ok: scope.ok && projects.every((p) => p.ok), scope, projects, minAccessLevel }
}

/**
 * Jira 寫入預檢：每個專案是否有指定權限（預設 CREATE_ISSUES / LINK_ISSUES）。
 * 回 { ok, projects:[{ key, ok, missing:[...], error? }] }
 */
export async function checkJiraWrite(jira, { projectKeys = [], permissions = ['CREATE_ISSUES', 'LINK_ISSUES'] } = {}) {
  const projects = []
  for (const key of projectKeys) {
    try {
      const perms = await jira.getMyPermissions(key, permissions)
      const missing = permissions.filter((p) => !perms?.[p]?.havePermission)
      projects.push({ key, ok: missing.length === 0, missing })
    } catch (err) {
      const e = toErrorResult(err)
      projects.push({ key, ok: false, missing: permissions, error: e.error, status: e.status })
    }
  }
  return { ok: projects.every((p) => p.ok), projects, permissions }
}
