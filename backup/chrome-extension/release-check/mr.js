#!/usr/bin/env node
// Standalone「開 MR」：在目標 repo 目錄裡跑（node <path>/release-check/mr.js），
// 自動抓當前 branch + origin，補上 assignee / label / target 後，開瀏覽器到 GitLab 預填的「新 MR」頁。
// token / jira projects 沿用 release-check 的 config（路徑相對於本檔，跟 cwd 無關）。
import { execFile } from 'child_process'
import { input, confirm, checkbox, search } from '@inquirer/prompts'
import { loadConfig } from './lib/config.js'
import { git, extractRepoPath } from './lib/repos.js'
import { GitlabClient } from './lib/gitlab.js'
import { branchNameToPrTitle, guessTargetBranch, buildNewMrUrl, discoverBrandsFromRepo, DEFAULT_WHITELABELS, DESCRIPTION_TEMPLATE } from './lib/mrUrl.js'
import { green, yellow, lightCyan, lightRed, blue, cyan } from '../color.js'

async function detectCwdRepo() {
  const cwd = process.cwd()
  let branch, remoteUrl
  try {
    branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  } catch {
    return { ok: false, error: `目前目錄不是 git repo：${cwd}` }
  }
  try {
    remoteUrl = await git(cwd, ['remote', 'get-url', 'origin'])
  } catch {
    return { ok: false, error: '這個 repo 沒有 origin remote' }
  }
  const repoPath = extractRepoPath(remoteUrl)
  if (branch === 'HEAD') return { ok: false, error: '目前是 detached HEAD，請先 checkout 到分支' }
  return { ok: true, cwd, branch, repoPath }
}

async function main() {
  const config = (() => {
    try {
      return loadConfig()
    } catch (err) {
      console.error(lightRed(`❌ 設定載入失敗：${err.message}`))
      return null
    }
  })()
  if (!config) return

  const detected = await detectCwdRepo()
  if (!detected.ok) return void console.error(lightRed(`❌ ${detected.error}`))
  const { branch, repoPath } = detected

  console.log('\n' + lightCyan('=== 開 MR ===') + '\n')
  console.log(cyan(`repo：${repoPath}`))
  console.log(cyan(`來源分支：${branch}`))

  const okBranch = await confirm({ message: `就用當前分支「${branch}」開 MR？`, default: true }).catch(() => null)
  if (!okBranch) return void console.log(yellow('取消（請先切到你要開 MR 的分支再跑一次）'))

  const jiraKeys = config.jira?.projects ?? []
  // brand 清單：優先掃當前 repo 的 src/brand-*；掃不到才退回半寫死清單 + 提示
  let whitelabels = discoverBrandsFromRepo(detected.cwd)
  if (whitelabels.length > 0) {
    console.log(cyan(`（brand 清單：從 src/brand-* 掃到 ${whitelabels.length} 個）`))
  } else {
    whitelabels = config.mrWhitelabels ?? DEFAULT_WHITELABELS
    console.log(yellow(`（沒掃到 src/brand-* 目錄，改用內建的半寫死清單 ${whitelabels.length} 個）`))
  }

  // 標題（預設 Draft: + 由 branch 生成，可編輯）
  const defaultTitle = `Draft: ${branchNameToPrTitle(branch, { jiraKeys, whitelabels })}`
  const title = await input({ message: '標題：', default: defaultTitle }).catch(() => null)
  if (title == null) return void console.log(yellow('取消'))

  // target 分支（預設用 guess，可改）
  const guessed = guessTargetBranch(repoPath, config.mrTargetOverrides ?? {})
  const targetBranch = await input({ message: 'target 分支：', default: guessed }).catch(() => null)
  if (!targetBranch) return void console.log(yellow('取消'))

  const gitlab = new GitlabClient(config.gitlab)

  // assignee：預設自己（用 token 的 current user），可改成搜尋別人
  const assigneeIds = []
  let me = null
  try {
    me = await gitlab.getCurrentUser()
  } catch (err) {
    console.log(yellow(`（讀取 GitLab 使用者失敗，assignee 先留空：${err.message}）`))
  }
  if (me) {
    const useSelf = await confirm({ message: `assignee 指定你自己（${me.name} @${me.username}）？`, default: true }).catch(() => null)
    if (useSelf) assigneeIds.push(me.id)
    else {
      const picked = await search({
        message: '搜尋 assignee（輸入關鍵字）：',
        source: async (term) => {
          if (!term) return []
          const users = await gitlab.searchUsers(term).catch(() => [])
          return users.map((u) => ({ name: `${u.name} @${u.username}`, value: u.id }))
        },
      }).catch(() => null)
      if (picked != null) assigneeIds.push(picked)
    }
  }

  // labels：選填，從 repo 的 label 清單多選
  let labels = []
  const wantLabels = await confirm({ message: '要加 label 嗎？', default: false }).catch(() => null)
  if (wantLabels) {
    try {
      const id = encodeURIComponent(repoPath)
      const all = await gitlab.requestPaged(`/projects/${id}/labels`)
      const choices = (all ?? []).map((l) => ({ name: l.name, value: l.name }))
      if (choices.length === 0) console.log(yellow('（這個 repo 沒有可選的 label）'))
      else {
        const chosen = await checkbox({ message: '選 label（空白鍵勾選）：', choices, loop: false, pageSize: 20 }).catch(() => null)
        if (chosen) labels = chosen
      }
    } catch (err) {
      console.log(yellow(`（讀取 label 失敗，略過：${err.message}）`))
    }
  }

  const url = buildNewMrUrl(config.gitlab.baseUrl, repoPath, {
    sourceBranch: branch,
    targetBranch,
    title,
    description: DESCRIPTION_TEMPLATE,
    assigneeIds,
    labels,
  })

  console.log('\n' + lightCyan('=== 預覽 ===') + '\n')
  console.log(`${cyan('標題：')}${title}`)
  console.log(`${cyan('分支：')}${branch} → ${targetBranch}`)
  console.log(`${cyan('assignee：')}${me && assigneeIds.length ? `${me.name}` : assigneeIds.join(', ') || '（無）'}`)
  console.log(`${cyan('labels：')}${labels.join(', ') || '（無）'}`)
  console.log(`${cyan('URL：')}${url}\n`)

  const open = await confirm({ message: '開瀏覽器到這個預填的新 MR 頁？（你在 GitLab 最後確認送出）', default: true }).catch(() => null)
  if (!open) return void console.log(green('沒開瀏覽器。URL 已印在上面，可自行貼上。'))

  execFile('open', [url], (err) => {
    if (err) console.error(lightRed(`開瀏覽器失敗：${err.message}（可手動貼上上面的 URL）`))
    else console.log(green('已開啟瀏覽器。'))
  })
}

main().catch((err) => {
  console.error(lightRed(`❌ 未預期錯誤：${err?.message ?? err}`))
})
