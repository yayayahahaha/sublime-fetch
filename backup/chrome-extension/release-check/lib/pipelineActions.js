// B — pipeline 的 engine 函式（不含互動；回 { ok, ... }）
import { toErrorResult } from './writeCommon.js'

function toVars(variables) {
  return Object.entries(variables ?? {}).map(([key, value]) => ({ key, value: String(value) }))
}

/**
 * dry-run 預覽：抓該 ref 的 .gitlab-ci.yml → ci/lint dry_run → 驗證能否編譯 + 回會建立的 job。
 * 這是預覽（不寫入），故不檢查 write scope。
 *
 * ⚠️ 限制：ci/lint 不接受自訂 pipeline 變數，也不會展開 parallel:matrix / trigger 子 pipeline，
 *    對 when:manual / rules 依變數選 job 的情境也不模擬。因此對「變數驅動」的 pipeline，
 *    jobs 可能為空，不代表真正觸發後不會產生 job。此時請用 `valid` 當作「YAML 能否編譯」的判斷。
 * 回 { ok:true, valid:true, jobs:[{ name, stage, when }], warnings, variables } | { ok:false, error, status }
 */
export async function previewPipeline(gitlab, { projectPath, ref, variables = {} } = {}) {
  if (!projectPath || !ref) return { ok: false, error: 'previewPipeline 缺少 projectPath / ref' }
  try {
    const content = await gitlab.getFileRaw(projectPath, '.gitlab-ci.yml', ref)
    const id = encodeURIComponent(projectPath)
    const res = await gitlab.request(`/projects/${id}/ci/lint`, { method: 'POST', body: { content, dry_run: true, ref } })
    if (res && res.valid === false) {
      return { ok: false, error: `.gitlab-ci.yml 驗證失敗：${(res.errors ?? []).join('; ') || '未知'}` }
    }
    const jobs = (res?.jobs ?? []).map((j) => ({ name: j.name, stage: j.stage, when: j.when ?? 'on_success' }))
    return { ok: true, valid: true, jobs, warnings: res?.warnings ?? [], variables }
  } catch (err) {
    return toErrorResult(err)
  }
}

/**
 * 查單一 pipeline 目前狀態（讀取、免寫權限）。回 { ok:true, status, webUrl } | { ok:false, error, status }
 */
export async function getPipeline(gitlab, { projectPath, pipelineId } = {}) {
  if (!projectPath || pipelineId == null) return { ok: false, error: 'getPipeline 缺少 projectPath / pipelineId' }
  try {
    const id = encodeURIComponent(projectPath)
    const p = await gitlab.request(`/projects/${id}/pipelines/${pipelineId}`)
    return { ok: true, status: p.status, webUrl: p.web_url }
  } catch (err) {
    return toErrorResult(err)
  }
}

/**
 * 取某 pipeline 的 downstream 子 pipeline（parent/child trigger）。
 * downstream 可能在別的專案，故一併回 projectId（數字，可直接當 project id 用）。
 * 回 { ok:true, downstreams:[{ id, projectId, status, webUrl }] } | { ok:false, error, status }
 */
export async function getPipelineBridges(gitlab, { projectPath, pipelineId } = {}) {
  if (!projectPath || pipelineId == null) return { ok: false, error: 'getPipelineBridges 缺少 projectPath / pipelineId' }
  try {
    const bridges = await gitlab.getPipelineBridges(projectPath, pipelineId)
    const downstreams = (bridges ?? [])
      .map((b) => b.downstream_pipeline)
      .filter(Boolean)
      .map((d) => ({ id: d.id, projectId: d.project_id, status: d.status, webUrl: d.web_url }))
    return { ok: true, downstreams }
  } catch (err) {
    return toErrorResult(err)
  }
}

/**
 * 觸發 pipeline。回 { ok:true, pipeline:{ id, webUrl, status } } | { ok:false, error, status }
 */
export async function triggerPipeline(gitlab, { projectPath, ref, variables = {} } = {}) {
  if (!projectPath || !ref) return { ok: false, error: 'triggerPipeline 缺少 projectPath / ref' }
  const scope = await gitlab.ensureWriteScope()
  if (!scope.ok) return scope
  try {
    const id = encodeURIComponent(projectPath)
    const p = await gitlab.request(`/projects/${id}/pipeline`, { method: 'POST', body: { ref, variables: toVars(variables) } })
    return { ok: true, pipeline: { id: p.id, webUrl: p.web_url, status: p.status } }
  } catch (err) {
    return toErrorResult(err)
  }
}

/**
 * 跑某個（通常是 manual 的）job。回 { ok:true, job:{ id, name, status, webUrl } } | { ok:false, error, status }
 */
export async function playJob(gitlab, { projectPath, jobId } = {}) {
  if (!projectPath || jobId == null) return { ok: false, error: 'playJob 缺少 projectPath / jobId' }
  const scope = await gitlab.ensureWriteScope()
  if (!scope.ok) return scope
  try {
    const id = encodeURIComponent(projectPath)
    const j = await gitlab.request(`/projects/${id}/jobs/${jobId}/play`, { method: 'POST' })
    return { ok: true, job: { id: j.id, name: j.name, status: j.status, webUrl: j.web_url } }
  } catch (err) {
    return toErrorResult(err)
  }
}

/**
 * 列出某 repo 的所有 pipeline schedules（只需讀取權限）。
 * 回 { ok:true, schedules:[{ id, description, active, ref }] } | { ok:false, error, status }
 */
export async function listPipelineSchedules(gitlab, { projectPath } = {}) {
  if (!projectPath) return { ok: false, error: 'listPipelineSchedules 缺少 projectPath' }
  try {
    const id = encodeURIComponent(projectPath)
    const arr = await gitlab.requestPaged(`/projects/${id}/pipeline_schedules`)
    const schedules = (arr ?? []).map((s) => ({ id: s.id, description: s.description, active: s.active, ref: s.ref }))
    return { ok: true, schedules }
  } catch (err) {
    return toErrorResult(err)
  }
}

/**
 * 取某個 pipeline schedule 的詳情（含 last_pipeline）。
 * 回 { ok:true, schedule:{ id, description, active, ref, nextRunAt, lastPipeline:{id,status}|null } } | { ok:false, error, status }
 */
export async function getPipelineSchedule(gitlab, { projectPath, scheduleId } = {}) {
  if (!projectPath || scheduleId == null) return { ok: false, error: 'getPipelineSchedule 缺少 projectPath / scheduleId' }
  try {
    const id = encodeURIComponent(projectPath)
    const s = await gitlab.request(`/projects/${id}/pipeline_schedules/${scheduleId}`)
    const lp = s?.last_pipeline
    return {
      ok: true,
      schedule: {
        id: s.id,
        description: s.description,
        active: s.active,
        ref: s.ref,
        nextRunAt: s.next_run_at,
        lastPipeline: lp ? { id: lp.id, status: lp.status } : null,
      },
    }
  } catch (err) {
    return toErrorResult(err)
  }
}

/**
 * 立即執行（Play）一個現有的 pipeline schedule。
 * ⚠️ GitLab 這個 endpoint 只回 201、不回被建立的 pipeline id；要拿到那條 pipeline 需另外輪詢
 *    getPipelineSchedule 的 lastPipeline。回 { ok:true } | { ok:false, error, status }
 */
export async function playPipelineSchedule(gitlab, { projectPath, scheduleId } = {}) {
  if (!projectPath || scheduleId == null) return { ok: false, error: 'playPipelineSchedule 缺少 projectPath / scheduleId' }
  const scope = await gitlab.ensureWriteScope()
  if (!scope.ok) return scope
  try {
    const id = encodeURIComponent(projectPath)
    await gitlab.request(`/projects/${id}/pipeline_schedules/${scheduleId}/play`, { method: 'POST' })
    return { ok: true }
  } catch (err) {
    return toErrorResult(err)
  }
}

/**
 * 建立排程 pipeline（cron）。variables 逐一加。
 * 回 { ok:true, schedule:{ id, description, nextRunAt } } | { ok:false, error, status }
 */
export async function schedulePipeline(gitlab, { projectPath, ref, cron, description, variables = {} } = {}) {
  if (!projectPath || !ref || !cron) return { ok: false, error: 'schedulePipeline 缺少 projectPath / ref / cron' }
  const scope = await gitlab.ensureWriteScope()
  if (!scope.ok) return scope
  try {
    const id = encodeURIComponent(projectPath)
    const sched = await gitlab.request(`/projects/${id}/pipeline_schedules`, {
      method: 'POST',
      body: { description: description ?? `${ref} schedule`, ref, cron },
    })
    for (const [key, value] of Object.entries(variables)) {
      await gitlab.request(`/projects/${id}/pipeline_schedules/${sched.id}/variables`, {
        method: 'POST',
        body: { key, value: String(value) },
      })
    }
    return { ok: true, schedule: { id: sched.id, description: sched.description, nextRunAt: sched.next_run_at } }
  } catch (err) {
    return toErrorResult(err)
  }
}
