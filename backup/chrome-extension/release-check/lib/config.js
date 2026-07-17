import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

export const CONFIG_PATH = path.join(ROOT, 'release-check.config.json')
export const SECRETS_PATH = path.join(ROOT, 'secrets.json')

function readJson(filePath, defaultName) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`找不到 ${path.basename(filePath)}，請先複製 ${defaultName} 為 ${path.basename(filePath)} 並填入你的設定`)
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (err) {
    throw new Error(`${path.basename(filePath)} 不是合法的 JSON：${err.message}`)
  }
}

// 驗證某個物件裡指定的欄位都有值（非空字串 / 非空陣列）
function requireFields(obj, fields, fileLabel) {
  const missing = []
  for (const field of fields) {
    const value = field.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj)
    const empty =
      value == null ||
      (typeof value === 'string' && value.trim() === '') ||
      (Array.isArray(value) && value.length === 0)
    if (empty) missing.push(field)
  }
  if (missing.length > 0) {
    throw new Error(`${fileLabel} 缺少必填欄位：${missing.join(', ')}`)
  }
}

/**
 * 載入並驗證 config + secrets。
 * 回傳合併後的設定物件（secrets 掛在對應區塊底下）。
 */
export function loadConfig() {
  const config = readJson(CONFIG_PATH, 'release-check.config.json.default')
  const secrets = readJson(SECRETS_PATH, 'secrets.json.default')

  requireFields(config, ['jira.baseUrl', 'jira.projects', 'gitlab.baseUrl', 'requiredRepos', 'localRepoPaths', 'stagingBranches'], 'release-check.config.json')
  requireFields(secrets, ['jira.email', 'jira.apiToken', 'gitlab.token'], 'secrets.json')

  return {
    jira: {
      baseUrl: config.jira.baseUrl.replace(/\/+$/, ''),
      projects: config.jira.projects,
      email: secrets.jira.email,
      apiToken: secrets.jira.apiToken,
    },
    gitlab: {
      baseUrl: config.gitlab.baseUrl.replace(/\/+$/, ''),
      token: secrets.gitlab.token,
    },
    requiredRepos: config.requiredRepos,
    localRepoPaths: config.localRepoPaths,
    stagingBranches: config.stagingBranches,
    doneBranches: config.doneBranches ?? [],
    fixVersionMatch: config.fixVersionMatch ?? null,
    defaultAssignee: config.defaultAssignee ?? null,
    doneStatuses: config.doneStatuses ?? [],
    sentToTestStatuses: config.sentToTestStatuses ?? [],
    urgentWithinDays: config.urgentWithinDays ?? 3,
    statusEmoji: config.statusEmoji ?? {},
    deploy: config.deploy ?? null,
    i18nRedeploy: config.i18nRedeploy ?? null,
    mrTargetOverrides: config.mrTargetOverrides ?? { 'btse-static-resource': 'master' },
    mrWhitelabels: config.mrWhitelabels ?? null,
  }
}
