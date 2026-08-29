// 「Play 現有排程」的互動流程（UX 層）。給無參數的排程用（例如「重新部署 I18n」）。
// 支援兩種指定方式：
//   - scheduleName：以名稱「完全匹配」找排程，且必須唯一（0 個或 >1 個都終止）。只需讀取權限，
//     適合沒有排程編輯權限、拿不到可靠 id 的情境。
//   - scheduleId：直接用 id。
//   兩者都給時以 name 匹配為準，id 只做交叉檢查（不一致會警告）。
// 底層：pipelineActions.listPipelineSchedules / getPipelineSchedule / playPipelineSchedule / getPipeline + watchers。
import { confirm } from '@inquirer/prompts'
import { GitlabClient } from './lib/gitlab.js'
import { extractRepoPath } from './lib/repos.js'
import { listPipelineSchedules, getPipelineSchedule, playPipelineSchedule, getPipeline } from './lib/pipelineActions.js'
import { spawnPipelineWatcher } from './lib/watchers.js'
import { green, yellow, lightCyan, lightRed, blue, cyan } from '../color.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const POLL_TIMES = 15
const POLL_INTERVAL_MS = 2000

// 依 preset 決定要 Play 哪一個排程 id。回 { ok:true, scheduleId } | { ok:false }（失敗訊息自行印出）
async function resolveScheduleId(gitlab, repoPath, { scheduleName, scheduleId }) {
  if (scheduleName) {
    console.log(blue(`🔍 以名稱完全匹配尋找排程：「${scheduleName}」…`))
    const listed = await listPipelineSchedules(gitlab, { projectPath: repoPath })
    if (!listed.ok) {
      console.error(lightRed(`❌ 讀取排程清單失敗：${listed.error}`))
      return { ok: false }
    }
    const matches = listed.schedules.filter((s) => s.description === scheduleName)
    if (matches.length === 0) {
      console.error(lightRed(`❌ 找不到名稱完全匹配「${scheduleName}」的排程，終止。`))
      return { ok: false }
    }
    if (matches.length > 1) {
      console.error(lightRed(`❌ 有 ${matches.length} 個排程名稱都是「${scheduleName}」，無法判斷是哪一個，終止。`))
      return { ok: false }
    }
    const matched = matches[0]
    if (scheduleId != null && scheduleId !== matched.id) {
      console.log(yellow(`⚠️ config 的 scheduleId（${scheduleId}）與名稱匹配到的排程 id（${matched.id}）不同；以名稱匹配為準。`))
    }
    return { ok: true, scheduleId: matched.id }
  }
  if (scheduleId != null) return { ok: true, scheduleId }
  console.error(lightRed('❌ 這個 pipeline 設定不完整（需要 scheduleName 或 scheduleId 其中之一）'))
  return { ok: false }
}

/**
 * 立即執行一個現有排程。preset = { label, repo, scheduleName?, scheduleId? }
 */
export async function runSchedulePlay(config, preset) {
  if (!preset?.repo) {
    console.error(lightRed('❌ 這個 pipeline 設定不完整（需要 repo）'))
    return
  }
  const repoPath = extractRepoPath(preset.repo)
  const gitlab = new GitlabClient(config.gitlab)
  const label = preset.label ?? '排程'

  console.log('\n' + lightCyan(`=== ${label} ===`) + '\n')
  console.log(cyan(`repo：${repoPath}`))

  const resolved = await resolveScheduleId(gitlab, repoPath, preset)
  if (!resolved.ok) return
  const scheduleId = resolved.scheduleId

  const info = await getPipelineSchedule(gitlab, { projectPath: repoPath, scheduleId })
  if (!info.ok) {
    console.error(lightRed(`❌ 讀取排程失敗：${info.error}`))
    return
  }
  const sc = info.schedule
  console.log(green(`✅ 目標排程 #${sc.id}`) + `：${sc.description}` + cyan(`  (ref=${sc.ref}${sc.active ? '' : '，已停用'})`))
  const prevPipelineId = sc.lastPipeline?.id ?? null
  if (prevPipelineId) console.log(cyan(`   上次執行：pipeline #${prevPipelineId}（${sc.lastPipeline.status}）`))
  if (!sc.active) console.log(yellow('   ⚠️ 這個排程目前是停用狀態，Play 仍可執行，但請確認是你要的。'))

  const go = await confirm({ message: `確定立即執行「${label}」（Play 排程 #${sc.id}）？`, default: false }).catch(() => null)
  if (!go) return void console.log(yellow('使用者取消'))

  const played = await playPipelineSchedule(gitlab, { projectPath: repoPath, scheduleId })
  if (!played.ok) return void console.error(lightRed(`❌ 觸發失敗：${played.error}`))
  console.log(green('✅ 已送出 Play 指令'))

  // Play 不回 pipeline id，輪詢 schedule.lastPipeline 直到出現新的一條
  console.log(blue('⏳ 等待新 pipeline 建立…'))
  let newPipeline = null
  for (let i = 0; i < POLL_TIMES; i++) {
    await sleep(POLL_INTERVAL_MS)
    const again = await getPipelineSchedule(gitlab, { projectPath: repoPath, scheduleId })
    if (again.ok && again.schedule.lastPipeline && again.schedule.lastPipeline.id !== prevPipelineId) {
      newPipeline = again.schedule.lastPipeline
      break
    }
  }

  const schedulesUrl = `${config.gitlab.baseUrl}/${repoPath}/-/pipeline_schedules`
  if (!newPipeline) {
    console.log(yellow('⚠️ 已送出 Play，但一段時間內沒偵測到新 pipeline（可能建立較慢、或被規則擋掉）。'))
    console.log(cyan(`   可到排程頁確認：${schedulesUrl}`))
    return
  }

  const pl = await getPipeline(gitlab, { projectPath: repoPath, pipelineId: newPipeline.id })
  const url = pl.ok ? pl.webUrl : `${config.gitlab.baseUrl}/${repoPath}/-/pipelines/${newPipeline.id}`
  console.log(green(`✅ 新 pipeline #${newPipeline.id}`) + `  ${url}`)

  const watch = await confirm({ message: '要背景監看這條 pipeline 嗎？（完成會發桌面通知）', default: true }).catch(() => null)
  if (!watch) return void console.log(green('已觸發，未開啟背景監看。'))

  const w = spawnPipelineWatcher({ projectPath: repoPath, pipelineId: newPipeline.id, url, label })
  console.log(w.ok ? green('已啟動背景監看。可從主選單「Watchers 背景監看任務」查看 / 停止。') : lightRed(`背景監看啟動失敗：${w.error}`))
}
