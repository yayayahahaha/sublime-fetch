# Write Automation — 用 GitLab / Jira token 做「寫入」自動化（追蹤用）

> 分支：`use-gitlab-and-jira`。這份是**發想 + 目標規格**，先討論再實作。
> 三個功能：A 一鍵開 MR、B pipeline 預覽+觸發、C Jira 批量開關聯單。
> 狀態：✅ 已定案　🟡 待討論　🔧 待實作

---

## 0. 共用前提 & 機制

### 0.1 權限（寫入動作的門檻）
- **GitLab**：需 token scope 含 **`api`**（read-write）。現有 `read_api` 只能讀。
  - 動作前先用 `GET /personal_access_tokens/self` 檢查 scope；沒 `api` → 擋下並提示換 token。
  - 另需該 repo **Developer 以上角色**（scope API 查不到，實際呼叫回 403 → 翻成友善訊息）。
- **Jira**：現有 email + API token 即可寫（依帳號權限）。

### 0.2 「查找 + select」resolver（沿用 assignee 那套，一般化）
一個共用互動：輸入關鍵字 → 打 API 查 → 0 筆報錯 / 1 筆直接用 / 多筆 select。用在：
- GitLab 使用者（assignee/reviewer）：`GET /users?username=` 或 `/users?search=` → user id
- Jira 使用者（assignee）：`GET /user/search`（已有）
- Jira issue link type：`GET /issueLinkType` → 選「is child of」那個 + 方向
- Jira issue type：專案的 issue types → 選 type

### 0.3 安全原則 ✅
- 所有寫入**先 dry-run / 預覽**（列出「會做什麼」）→ 使用者確認 → 才執行。
- 對外、不可逆的動作（建單、開 MR、觸發 deploy）預設「先問」。

---

## A. 一鍵開 MR 🟡

**觸發點**：release-check 報表已知「該開 develop MR 卻還沒開」的單 → 對這些單一鍵開 MR；或獨立指令指定 branch。

**API**：`POST /projects/:id/merge_requests`

| 欄位 | 自動帶入 |
|---|---|
| `source_branch` / `target_branch` | branch + 目標（dev/staging/**develop**）|
| `title` | branch 抽 key → Jira summary → `PLAT-xxx {summary}` |
| `description` | 固定 template（Jira link、checklist…）|
| `assignee_ids` / `reviewer_ids` | 查找+select 解析成 user id |
| `labels` | 固定標籤集（config）|
| `remove_source_branch` / `squash` | config 預設 |

**流程**：檢查 `api` scope → 組好欄位 → 預覽（title/target/labels/assignee）→ 確認 → 建立 → （可選）把 MR link 回貼 Jira。
🟡 待定：description template 內容、固定 label 集、要不要一次開多個 target。

## B. Pipeline 預覽 + 觸發 🟡

**預覽（dry-run）**：`POST /projects/:id/ci/lint`（`content` + `ref` + `dry_run:true`）→ 回「會建立哪些 job/stage」（套用 rules），不執行。先抓該 ref 的 `.gitlab-ci.yml` 當 content。
**觸發**：`POST /projects/:id/pipeline`（`ref` + `variables`）。
**手動 job**：`POST /projects/:id/jobs/:job_id/play`（deploy 這種 manual 的第二步才跑）。
**排程**：`POST /projects/:id/pipeline_schedules`（cron + ref + variables）。

**呈現**：
```
觸發 pipeline @ ref=develop, variables={DEPLOY_ENV:staging}
會建立：build(build) / unit-test(test) / deploy-stg(deploy, manual←需手動 play)
確認觸發？(y/N)
```
天然安全閥：manual 的 deploy 觸發後不會自動跑，要再 play。
🟡 待定：ci/lint dry_run 的實際回傳格式（實作時用真專案驗證）；要支援的 variables。

## C. Jira 批量開「關聯單」🟡

**輸入**：多個母單 key。**對每個母單**建一張獨立 issue，再用 link 關聯（`is child of`）。

- 建 issue：`POST /rest/api/3/issue`
  - `fields`: project、`issuetype`（查找+select）、`summary`（template）、`description`（**ADF JSON**，非純文字）、`assignee: {accountId}`（查找+select）、`labels`
- 建關聯：`POST /rest/api/3/issueLink`
  - `type: { name }`（由 `GET /issueLinkType` 查找+select「is child of」）、`inwardIssue/outwardIssue`（方向：誰 is child of 誰）
  - ⚠️ 方向要對：link type 有 `inward`(如 "is child of") / `outward`(如 "is parent of")；child = inwardIssue、parent = outwardIssue（依選到的 type 而定）。

**固定欄位（config / 互動一次設定，套用到每一張）**：assignee、labels、issuetype、description template。
**流程**：檢查 Jira 權限 → 解析 assignee / issuetype / linktype（查找+select，只問一次）→ dry-run 列出「會在 A/B/C 母單下各建一張 {type} 單、assignee=X、label=Y」→ 確認 → 逐一建立 + 建 link → 回報建立結果（新單 key + link）。
🟡 待定：summary/description template、固定 label/assignee/type 從 config 還是每次互動輸入。

---

## 5. 函式介面（engine 層，先做這層；UI 之後再包）🔧

### 5.0 通用回傳慣例
所有動作函式**不 throw**（預期的 API 失敗都攔下），統一回傳：
```js
// 成功
{ ok: true, ...payload }
// 失敗
{ ok: false, error: '<人可讀訊息>', status?: <http status> }
```
錯誤訊息盡量帶上原因（如 `409 MR already exists`、`403 權限不足（需 Developer 角色）`、`token 缺 api scope`）。

### 5.1 共用 helpers
```js
// 寫入前檢查 GitLab token scope（沒 api → ok:false）
ensureGitlabWriteScope(gitlab): Promise<{ ok, scopes } | { ok:false, error }>

// 查找（給 UI 做 select 用；回候選，不互動）
gitlab.searchUsers(query): Promise<[{ id, username, name }]>
jira.searchUsers(query): Promise<[...]>                 // 已有
jira.getIssueLinkTypes(): Promise<[{ id, name, inward, outward }]>
jira.getProjectIssueTypes(projectKey): Promise<[{ id, name, subtask }]>

// 純文字 → Jira ADF（description 用）
textToAdf(text): object
```

### 5.2 A — 開 MR（`lib/mrActions.js`）
```js
createMergeRequest(gitlab, {
  projectPath, sourceBranch, targetBranch,
  title, description,
  assigneeIds = [], reviewerIds = [],
  labels = [], removeSourceBranch = true, squash = false,
}): Promise<{ ok:true, mr:{ iid, webUrl, title, targetBranch } } | { ok:false, error, status }>

// 用 ticket + template 組出 title/description（不打建立，只組欄位；給呼叫端填進 createMergeRequest）
buildMrFields({ key, summary, jiraUrl, template }): { title, description }
```

### 5.3 B — pipeline（`lib/pipelineActions.js`）
```js
// dry-run 預覽：抓該 ref 的 .gitlab-ci.yml → ci/lint dry_run → 回會建立的 job
previewPipeline(gitlab, { projectPath, ref, variables = {} }):
  Promise<{ ok:true, jobs:[{ name, stage, when }] } | { ok:false, error, status }>

triggerPipeline(gitlab, { projectPath, ref, variables = {} }):
  Promise<{ ok:true, pipeline:{ id, webUrl, status } } | { ok:false, error, status }>

playJob(gitlab, { projectPath, jobId }):
  Promise<{ ok:true, job:{ id, name, status, webUrl } } | { ok:false, error, status }>

schedulePipeline(gitlab, { projectPath, ref, cron, description, variables = {} }):
  Promise<{ ok:true, schedule:{ id, description, nextRunAt } } | { ok:false, error, status }>
```

### 5.4 C — Jira 批量關聯單（`lib/jiraCreateActions.js`）
```js
// 建一張獨立 issue + 用 link 綁到母單（is child of）
createLinkedChildIssue(jira, {
  parentKey, projectKey, issueType,
  summary, descriptionAdf, assigneeAccountId = null, labels = [],
  linkTypeName, childIsInward,   // 方向：true = child 是 inwardIssue（"is child of" 落在 inward 時）
}): Promise<{ ok:true, issue:{ key, url }, link:{ ok:true } | { ok:false, error } } | { ok:false, error, status }>

// 批量：對多個母單各建一張；部分失敗不中斷，逐筆回報
createLinkedChildIssues(jira, { parents:[key], fields /* 上面除 parentKey 外的固定欄位 */ }):
  Promise<{ ok:true, results:[{ parentKey, ok, issueKey?, url?, error? }] }>
```

### 5.5 寫入權限預檢（`lib/writePreflight.js`）
操作前先確認 token 權限，並區分是 **scope / 角色 / Jira 權限** 哪種問題（都唯讀）。
```js
checkGitlabWrite(gitlab, { projectPaths, minAccessLevel = 30 /* Developer */ }):
  Promise<{ ok, scope:{ ok, scopes?, error? }, projects:[{ path, ok, accessLevel, accessLabel?, error? }] }>

checkJiraWrite(jira, { projectKeys, permissions = ['CREATE_ISSUES','LINK_ISSUES'] }):
  Promise<{ ok, projects:[{ key, ok, missing:[...], error? }] }>
```
支援 API：`gitlab.getProjectAccessLevel(path)`（讀 permissions.project_access/group_access）、`jira.getMyPermissions(key, perms)`（`/mypermissions`）。

> 設計原則：這些函式**只做事、回結果**，不含任何 `prompt`/`console` 互動；「查找+select、確認、dry-run 呈現」都由之後的 UI 層組合這些函式完成。

## 🔧 TODO

### engine 層（已完成 ✅）
- [x] 共用：`ensureGitlabWriteScope`（gitlab.js）+ `toErrorResult` 友善訊息（writeCommon.js）
- [x] 共用查找 API：`gitlab.searchUsers` / `jira.getIssueLinkTypes` / `jira.getProjectIssueTypes`（回候選，不互動）
- [x] client 支援 POST body（gitlab/jira）、容忍空 body 回應
- [x] A：`lib/mrActions.js`（`createMergeRequest` + `buildMrFields`）
- [x] B：`lib/pipelineActions.js`（`previewPipeline` dry-run / `triggerPipeline` / `playJob` / `schedulePipeline`）
- [x] C：`lib/jiraCreateActions.js`（`createLinkedChildIssue` / `createLinkedChildIssues` / `textToAdf`）
- [x] 寫入權限預檢 `lib/writePreflight.js`（`checkGitlabWrite` scope+角色 / `checkJiraWrite` 權限）
- [x] mock 單元測試全過（21 項：body 映射、scope 擋、409 訊息、variables 轉換、preview jobs、link 方向、批量逐筆、權限預檢 scope/角色/Jira）

### UI / 整合層
- [ ] 「查找+select」互動包裝（linktype / issuetype），C 用，待做（MR 的 assignee 搜尋已用 @inquirer/search 完成）
- [x] A：Standalone「開 MR」`mr.js` 已完成 — 在目標 repo 目錄跑，自動抓 cwd 當前 branch + origin，
  由 branch 生成標題（`branchNameToPrTitle`）、猜 target（`guessTargetBranch`）、assignee 預設自己（getCurrentUser，可搜尋改人）、
  label 從 repo 清單多選、套用描述樣板，最後開瀏覽器到 GitLab 預填「新 MR」頁（人工送出）。純函式在 `lib/mrUrl.js`（單元測試 11/11）。
  註：採「產預填 URL 開瀏覽器」路線；`lib/mrActions.js` 的 API createMergeRequest engine 仍保留供未來直接建立用。
- [x] B：Pipeline UI 已完成 — 部署 brand 到 staging（matrix 多選 + dry-run + downstream 追蹤）＋ 重新部署 I18n（Play 排程，名稱完全匹配唯一），皆可背景監看，已實測
- [ ] C：輸入多母單 → 一次設定固定欄位 → dry-run 列出 → 確認 → 批量建立 + 回報 — 待做
- [ ] 各功能 config 欄位（label 集、MR description template、固定 assignee/type…）

### 待實測（需 user 換 api-scope token）
- [ ] A/B 用真 GitLab（api scope）實測；ci/lint dry_run 實際回傳格式確認
- [ ] C 用真 Jira 實測（issueLinkType 名稱/方向、ADF description、issuetype 名稱）

## 🟡 待討論（開工前要定）
1. A 的 description template / 固定 label；要不要一次開多 target。
2. B 要支援哪些 variables；ci/lint dry_run 實際格式。
3. C 的固定欄位來源（config vs 互動）、summary/description template。
4. 三個的優先順序（先做哪個）。

---

## 🚀 已實作：部署 brand 到 staging（B 的第一個實際 UX）

入口：t99「Pipeline（GitLab）」→「執行：部署 brand 到 staging」。

### 固定規則（不開放設定）
- **branch 一律 `staging`**。
- pipeline variable：type=Variable、**key=`RECIPE`**、value=選到的 **WHITELABEL_NAME**。
- **一 brand 一條 pipeline**（多選 N 個 → 觸發 N 條，各自可背景監看）。

### brand 清單來源
config `deploy.repo` 指定的 repo，讀其 `staging` 分支根目錄固定檔
`.gitlab-ci.staging-whitelabel-matrix.config.yml`，取
`.staging-whitelabel-matrix.parallel.matrix[].WHITELABEL_NAME`。

### 逐層嚴謹檢查（`lib/deployStaging.js` → `loadStagingRecipes`）
任一層失敗即停，回 `{ ok:false, stage, error }`，stage ∈：
1. `config` — 未設 `deploy.repo`
2. `repo` — repo 不存在 / 無權限（GET `/projects/:id` 404）
3. `branch` — 無 remote `staging`（GET `/repository/branches/staging` 404）
4. `file` — staging 分支無該 matrix 檔（getFileRaw 404）
5. `format` — matrix 檔結構不符（`parseWhitelabelMatrix` 嚴謹解析固定階層）
6. `pattern` — 有 WHITELABEL_NAME 不符 `/[^\s]\sstaging$/`

### 流程（`deployActions.js` → `runDeployStaging`）
清單檢查 → checkbox 多選 → **每個 brand 必跑一次 dry-run**（`previewPipeline`，ci/lint dry_run，列 job）
→ 彙總確認 → 逐個 `triggerPipeline`（ref=staging, `RECIPE`=名字）→ 印 pipeline URL
→ opt-in 背景監看（`spawnPipelineWatcher`，label=`staging：<brand>`，完成發桌面通知）。

### 測試
- `parseWhitelabelMatrix`：17/17（範例、引號、註解、缺各層、缺/空 WHITELABEL_NAME、pattern 反例）。
- `loadStagingRecipes`：7/7（happy + 每一層 404 停在對的 stage + format + pattern + 缺 config）。
- import chain 乾淨、不自動執行。

---

## 🚀 已實作：Play 現有排程（第二種「執行 pipeline」）

入口：t99「Pipeline（GitLab）」→「執行」→ 選單列出所有可執行 pipeline 動作。

### config（各動作各自一個專屬區塊，寫死）
- `deploy.repo`：「部署 brand 到 staging」用。
- `i18nRedeploy: { repo, scheduleId }`：「重新部署 I18n」用——立即 Play 一個現有排程（不帶參數）。
  `scheduleId` 從排程頁 URL `.../pipeline_schedules/<id>/edit` 取。
- Pipeline → 執行 選單直接寫死列出這兩個動作（哪個 config 有設就出現哪個）。

### engine（`lib/pipelineActions.js`）
- `getPipelineSchedule(gitlab, { projectPath, scheduleId })` → `{ ok, schedule:{ id, description, active, ref, nextRunAt, lastPipeline:{id,status}|null } }`
- `playPipelineSchedule(gitlab, { projectPath, scheduleId })` → `{ ok }`（需 api scope）
  - ⚠️ GitLab `/pipeline_schedules/:id/play` 只回 201、**不回 pipeline id**。

### 流程（`scheduleActions.js` → `runSchedulePlay`）
讀排程（顯示 description / ref / 停用與否 / 上次 pipeline）→ 確認 → Play
→ **輪詢 `lastPipeline` 直到出現新 pipeline**（Play 不回 id 的解法）→ 印 URL → opt-in 背景監看。

### 測試
- schedule engine mock：4/4（解析、play 成功打 POST、無 api scope 擋下不打 API、缺參數回錯）。
