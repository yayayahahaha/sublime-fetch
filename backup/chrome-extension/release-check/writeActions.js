// 寫入自動化的互動入口（開 MR / Pipeline / Jira 關聯單）。
// token 沿用 release-check 的 config + secrets.json（資料夾層級之後再處理）。
// 目前第二層先接「權限預檢」；實際操作 UI（查找+select、dry-run、執行）待後續。
import select from '@inquirer/select'
import { confirm } from '@inquirer/prompts'
import { loadConfig } from './lib/config.js'
import { GitlabClient } from './lib/gitlab.js'
import { JiraClient } from './lib/jira.js'
import { extractRepoPath } from './lib/repos.js'
import { checkGitlabWrite, checkJiraWrite } from './lib/writePreflight.js'
import { readAllWatchers, killWatcher, cleanupDead } from './lib/watchers.js'
import { runDeployStaging } from './deployActions.js'
import { runSchedulePlay } from './scheduleActions.js'
import { red, green, yellow, lightCyan, lightRed, blue } from '../color.js'

const FEATURES = {
  mr: { label: '開 MR（GitLab）', system: 'gitlab' },
  pipeline: { label: 'Pipeline（GitLab）', system: 'gitlab' },
  jira: { label: 'Jira 關聯單', system: 'jira' },
}

function shortRepo(required) {
  return String(required).replace(/\.git$/i, '').replace(/\/+$/, '').split('/').pop()
}

function loadConfigOrReport() {
  try {
    return loadConfig()
  } catch (err) {
    console.error(lightRed(`❌ 設定載入失敗：${err.message}`))
    return null
  }
}

function renderGitlabWritePreflight(r) {
  console.log('\n' + lightCyan('=== GitLab 寫入權限預檢 ===') + '\n')
  console.log(r.scope.ok ? green('✅ token scope：含 api（可寫入）') : lightRed(`❌ token scope：${r.scope.error}`))
  for (const p of r.projects) {
    if (p.ok) console.log(green(`✅ ${shortRepo(p.path)}：${p.accessLabel}(${p.accessLevel})`))
    else console.log(lightRed(`❌ ${shortRepo(p.path)}：${p.error ?? `角色不足 ${p.accessLabel ?? p.accessLevel}（需 ≥Developer/30）`}`))
  }
  console.log('\n' + (r.ok ? green('✅ 權限足夠，可執行寫入') : lightRed('❌ 權限不足，無法執行寫入')) + '\n')
}

function renderJiraWritePreflight(r) {
  console.log('\n' + lightCyan('=== Jira 寫入權限預檢 ===') + '\n')
  for (const p of r.projects) {
    if (p.ok) console.log(green(`✅ ${p.key}：${r.permissions.join(' / ')} 都有`))
    else console.log(lightRed(`❌ ${p.key}：缺 ${p.missing.join(', ')}${p.error ? ` — ${p.error}` : ''}`))
  }
  console.log('\n' + (r.ok ? green('✅ 權限足夠，可執行寫入') : lightRed('❌ 權限不足，無法執行寫入')) + '\n')
}

async function runPreflight(feature, config) {
  console.log(blue('🔍 檢查寫入權限中…'))
  try {
    if (FEATURES[feature].system === 'gitlab') {
      const gitlab = new GitlabClient(config.gitlab)
      const projectPaths = (config.requiredRepos ?? []).map(extractRepoPath)
      renderGitlabWritePreflight(await checkGitlabWrite(gitlab, { projectPaths }))
    } else {
      const jira = new JiraClient(config.jira)
      renderJiraWritePreflight(await checkJiraWrite(jira, { projectKeys: config.jira.projects }))
    }
  } catch (err) {
    console.error(lightRed(`❌ 預檢失敗：${err.message}`))
  }
}

/**
 * 單一寫入功能的互動入口，供 t99 呼叫。feature ∈ 'mr' | 'pipeline' | 'jira'
 */
export async function writeActionHelper(feature) {
  const meta = FEATURES[feature]
  if (!meta) return void console.error(lightRed(`未知的 write feature：${feature}`))

  const config = loadConfigOrReport()
  if (config == null) return

  // pipeline：權限預檢 + 各 pipeline 動作攤平在同一層；其餘功能維持 preflight + 執行(未實作)。
  const choices =
    feature === 'pipeline'
      ? [
          { name: '權限預檢（preflight）', value: 'preflight', description: '確認 token scope / 專案角色是否足夠寫入' },
          { name: '部署 brand 到 staging', value: 'deploy-staging', description: '從 matrix 檔多選 brand → dry-run → 觸發 → 可背景監看' },
          { name: '重新部署 I18n', value: 'i18n', description: 'Play I18n 排程（需 config.i18nRedeploy）' },
        ]
      : [
          { name: '權限預檢（preflight）', value: 'preflight', description: '確認 token scope / 專案角色 / Jira 權限是否足夠寫入' },
          { name: '執行（尚未實作）', value: 'run', description: 'engine 函式已完成，操作 UI 待接' },
        ]

  const action = await select({ message: `${meta.label}：要做什麼？`, choices, loop: false }).catch(() => null)
  if (action == null) return void console.log(yellow('使用者取消'))

  if (action === 'preflight') return void (await runPreflight(feature, config))
  if (action === 'deploy-staging') return void (await runDeployStaging(config))
  if (action === 'i18n') {
    const c = config.i18nRedeploy
    if (!c?.repo || (c.scheduleId == null && !c.scheduleName)) {
      return void console.log(yellow('「重新部署 I18n」尚未設定完整：請在 release-check.config.json 的 i18nRedeploy 填 repo，以及 scheduleName 或 scheduleId'))
    }
    return void (await runSchedulePlay(config, { ...c, label: '重新部署 I18n' }))
  }
  console.log(yellow(`「${meta.label}」的操作 UI 尚未實作（engine 已完成，可先跑權限預檢）`))
}

function fmtWatcher(w) {
  const dot = w.alive ? '🟢' : '⚪️'
  const title = w.label || `${w.projectPath} #${w.pipelineId}`
  return `${dot} ${title}  [${w.status}]${w.url ? `  ${w.url}` : ''}`
}

/**
 * 背景監看任務管理入口，供 t99 呼叫：列出、kill、清除。
 */
export async function watchersHelper() {
  const list = readAllWatchers()
  console.log('\n' + lightCyan('=== 背景監看任務 ===') + '\n')
  if (list.length === 0) return void console.log(yellow('目前沒有背景監看任務。\n'))
  for (const w of list) console.log('  ' + fmtWatcher(w))
  console.log('')

  const action = await select({
    message: '要做什麼？',
    choices: [
      ...list.filter((w) => w.alive).map((w) => ({ name: `kill：${w.label || w.pipelineId}（pid ${w.pid}）`, value: `kill:${w.pid}` })),
      { name: '清除已結束 / 已死的紀錄', value: 'cleanup' },
      { name: '離開', value: 'exit' },
    ],
    loop: false,
  }).catch(() => null)
  if (action == null || action === 'exit') return

  if (action === 'cleanup') {
    return void console.log(green(`已清除 ${cleanupDead()} 筆已結束 / 已死的紀錄`))
  }
  if (action.startsWith('kill:')) {
    const pid = Number(action.slice(5))
    const go = await confirm({ message: `確定 kill pid ${pid}？（pipeline 在 server 端會繼續跑，只停本地監看）`, default: false }).catch(() => null)
    if (!go) return void console.log(yellow('取消'))
    const r = killWatcher(pid)
    console.log(r.ok ? green(`已停止監看 pid ${pid} 並移除紀錄`) : lightRed(`kill 失敗：${r.error}`))
  }
}
