// 「部署 brand 到 dev / staging」的互動流程（UX 層，底層沿用 deployStaging + pipelineActions + watchers）。
// 流程：載入清單（嚴謹檢查）→ 多選 brand → 每個 brand 一次 dry-run 預覽（必跑）→ 確認
//       → 逐個觸發 pipeline（ref=目標分支, RECIPE=該 WHITELABEL_NAME）→ 印 URL → 選擇性背景監看。
import { checkbox, confirm } from '@inquirer/prompts'
import { GitlabClient } from './lib/gitlab.js'
import { extractRepoPath } from './lib/repos.js'
import { loadDeployRecipes, DEPLOY_TARGETS, RECIPE_VAR_KEY } from './lib/deployStaging.js'
import { previewPipeline, triggerPipeline } from './lib/pipelineActions.js'
import { spawnPipelineWatcher } from './lib/watchers.js'
import { green, yellow, lightCyan, lightRed, blue, cyan } from '../color.js'

const stageHintOf = (target) => ({
  config: '請在 release-check.config.json 設定 deploy.repo（要部署的 repo URL）',
  repo: '確認 repo URL 正確、且 token 有讀取權限',
  branch: `確認該 repo 有 remote 的 ${target.branch} 分支`,
  file: `確認 ${target.branch} 分支根目錄有 ${target.matrixFile}`,
  format: `請檢查 matrix 檔的結構（${target.rootKey} → parallel → matrix → WHITELABEL_NAME）`,
  pattern: '請修正 matrix 檔裡不符合命名規則的 WHITELABEL_NAME',
})

/**
 * 部署 brand 的互動流程本體。target ∈ DEPLOY_TARGETS（dev / staging 機制同構，只差參數）。
 * config 由呼叫端（writeActionHelper）載入後傳入。
 */
async function runDeployBrand(config, target) {
  const envLabel = target.key
  const repoUrl = config.deploy?.repo
  if (!repoUrl) {
    console.error(lightRed('❌ 尚未設定部署 repo。請在 release-check.config.json 加入 deploy.repo'))
    return
  }
  const repoPath = extractRepoPath(repoUrl)
  const gitlab = new GitlabClient(config.gitlab)

  console.log('\n' + lightCyan(`=== 部署 brand 到 ${envLabel} ===`) + '\n')
  console.log(cyan(`repo：${repoPath}   分支：${target.branch}`))
  console.log(blue('🔍 讀取 whitelabel 清單並檢查中…'))

  const loaded = await loadDeployRecipes(gitlab, { repoPath, target })
  if (!loaded.ok) {
    const hint = stageHintOf(target)[loaded.stage]
    console.error(lightRed(`\n❌ [${loaded.stage}] ${loaded.error}`))
    if (hint) console.error(yellow(`   → ${hint}`))
    return
  }
  console.log(green(`✅ 檢查通過，共 ${loaded.recipes.length} 個可部署 brand\n`))

  const sortedRecipes = [...loaded.recipes].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
  const chosen = await checkbox({
    message: `選要部署到 ${envLabel} 的 brand（空白鍵勾選，Enter 確認）：`,
    choices: sortedRecipes.map((name) => ({ name, value: name })),
    loop: true,
    required: true,
    pageSize: 25,
  }).catch(() => null)
  if (chosen == null || chosen.length === 0) return void console.log(yellow('使用者取消 / 沒選任何 brand'))

  // Dry-run（必跑）。注意：ci/lint 只驗證 .gitlab-ci.yml 能否編譯——它不吃自訂變數、
  // 也不會展開 RECIPE→matrix / trigger 子 pipeline，所以 job 數常為 0，不代表不會執行。
  // 真正跑哪個 whitelabel 由 CI 規則 `$WHITELABEL_NAME == $RECIPE` 決定，與所選 brand 一一對應。
  console.log('\n' + lightCyan('=== Dry-run（不會實際執行）===') + '\n')
  const lint = await previewPipeline(gitlab, { projectPath: repoPath, ref: target.branch })
  if (!lint.ok) return void console.error(lightRed(`❌ .gitlab-ci.yml 驗證失敗，中止：${lint.error}`))
  console.log(green('✅ .gitlab-ci.yml 通過驗證') + cyan(`（分支 ${target.branch}）`))
  console.log(cyan('ℹ️ 實際觸發的 whitelabel job 由 CI 依 RECIPE 選出，lint 無法預先列出，屬正常。'))

  const runnable = chosen.map((recipe) => ({ recipe, variables: { [RECIPE_VAR_KEY]: recipe } }))

  console.log('\n' + lightCyan('=== 即將觸發 ===') + '\n')
  console.log(cyan(`repo：${repoPath}   分支：${target.branch}`))
  console.log(`共 ${runnable.length} 條 pipeline（一 brand 一條，${RECIPE_VAR_KEY}=各自的 WHITELABEL_NAME）：`)
  for (const p of runnable) console.log(green(`  • ${p.recipe}`) + cyan(`   ${RECIPE_VAR_KEY}=${p.recipe}`))
  console.log('')

  const go = await confirm({ message: `確定觸發這 ${runnable.length} 條 ${envLabel} pipeline？`, default: false }).catch(() => null)
  if (!go) return void console.log(yellow('使用者取消，未觸發任何 pipeline'))

  const triggered = []
  console.log('')
  for (const p of runnable) {
    const r = await triggerPipeline(gitlab, { projectPath: repoPath, ref: target.branch, variables: p.variables })
    if (!r.ok) {
      console.error(lightRed(`❌ ${p.recipe}：觸發失敗 — ${r.error}`))
      continue
    }
    console.log(green(`✅ ${p.recipe}`) + `  #${r.pipeline.id}  ${r.pipeline.webUrl}`)
    triggered.push({ recipe: p.recipe, pipeline: r.pipeline })
  }

  if (triggered.length === 0) return void console.error(lightRed('\n沒有任何 pipeline 觸發成功。'))

  const watch = await confirm({
    message: `要背景監看這 ${triggered.length} 條 pipeline 嗎？（完成會發桌面通知）`,
    default: true,
  }).catch(() => null)
  if (!watch) return void console.log(green(`\n已觸發 ${triggered.length} 條 pipeline，未開啟背景監看。`))

  let watched = 0
  for (const t of triggered) {
    const w = spawnPipelineWatcher({
      projectPath: repoPath,
      pipelineId: t.pipeline.id,
      url: t.pipeline.webUrl,
      label: `${envLabel}：${t.recipe}`,
    })
    if (w.ok) watched++
    else console.error(lightRed(`背景監看啟動失敗（${t.recipe}）：${w.error}`))
  }
  console.log(green(`\n已啟動 ${watched} 個背景監看。可從主選單「背景監看任務」查看 / 停止。`))
}

/** 部署 brand 到 staging 的互動入口。 */
export const runDeployStaging = (config) => runDeployBrand(config, DEPLOY_TARGETS.staging)

/** 部署 brand 到 dev 的互動入口。 */
export const runDeployDev = (config) => runDeployBrand(config, DEPLOY_TARGETS.dev)
