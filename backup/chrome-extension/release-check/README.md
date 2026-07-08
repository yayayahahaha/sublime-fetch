# release-check

依 Jira fix version 檢查各 GitLab repo 的 branch / 合併 / Merge Request 狀態的 CLI 工具。

> 目前進度：**Phase 0（設定）、Phase 1（Preflight）、Phase 2（撈 ticket）、Phase 3（分支 / 合併分析）、Phase 4（GitLab MR 查詢）** 已完成。
> 「完整檢查流程（含 GitLab MR）」= 撈 ticket + 分支分析 + 查 MR 的彙整報表。
>
> MR 查詢：對每個已 push 的分支，查 `GET /projects/:id/merge_requests?source_branch=<branch>&state=all`，
> 列出各 MR 的 target branch 與狀態（opened/merged/closed）。GitLab project id 由本地
> origin remote 的真實路徑推導（保留大小寫）。
>
> 未解決討論：對還開著（opened）的 MR，另查 `.../discussions`（分頁撈完），數出
> 「resolvable 且尚未 resolved」的討論串數，顯示在該 MR 後面（未解決 N／全解決）。
>
> 分支分析：對每個對應到本地的 repo（可選先 `git fetch --all --prune`），針對每張
> ticket 找出名稱含 ticket key 的分支（不拘位置、忽略大小寫），並用
> `git branch --all --contains` 判斷是否已合併進 target 分支（dev/staging/…），
> 同時比對本地與 `origin/同名` 分支偵測「尚未 push」或「領先 N commit」。
>
> fix version 挑選規則：從版本名稱抽出 8 碼 `YYYYMMDD`，選出 date token 落在
> 「今天 ~ 今天 + `daysAhead` 天」的版本（預設 30 天，執行時可互動覆寫），
> 再撈這些版本底下的所有 ticket（不過濾狀態）。
>
> assignee 過濾：撈 ticket 時可指定 assignee（名字或 email，預設取 config 的
> `defaultAssignee`，可互動覆寫或清空為不限）。搜尋前會先呼叫 Jira 使用者 API
> 驗證此人是否存在並解析成 accountId——查無此人會中止，多筆符合則讓你選。

## 設定

1. 複製兩個設定檔（實際檔案已被 `.gitignore`，不會進 git）：

   ```sh
   cp release-check/release-check.config.json.default release-check/release-check.config.json
   cp release-check/secrets.json.default release-check/secrets.json
   ```

2. 填 `secrets.json`：
   - `jira.email` + `jira.apiToken`：Jira Cloud 用 **email + API token**（不是 PAT）。到
     <https://id.atlassian.com/manage-profile/security/api-tokens> 產生 API token。
   - `gitlab.token`：GitLab Personal Access Token，scope 需勾 **`read_api`**。

3. 填 `release-check.config.json`：
   - `jira.baseUrl`：`https://btse.atlassian.net`
   - `jira.projects`：要撈的 Jira project key
   - `gitlab.baseUrl`：你們 GitLab 網址
   - `requiredRepos`：**必檢 repo 清單**（`namespace/project` 或完整 git URL）
   - `localRepoPaths`：本機已 clone 的 repo 路徑；工具會用 `git remote` 驗證
     `requiredRepos` 是否都在本機
   - `targetBranches`：要檢查有沒有合併進去的分支（如 `dev` / `staging` / `develop`）
   - `fixVersionMatch`：Phase 6 才會用到，目前留 `null`

## 使用

### 互動式（t99 選單或直接跑）

```sh
node release-check/index.js          # 互動式選單
```

### 非互動 CLI（可排程 / CI）

CLI **預設輸出 JSON**（stdout 乾淨，錯誤走 stderr）；加 `--pretty` 才彩色文字。

```sh
# 完整流程 → JSON（預設）
node release-check/index.js --full --assignee amy@btse.com > report.json

# 只撈 ticket → JSON
node release-check/index.js --tickets --days 30

# 想看彩色文字就加 --pretty
node release-check/index.js --full --pretty
node release-check/index.js --preflight --pretty
```

旗標：`--days <n>`、`--assignee <name|email>`（需唯一命中）、`--no-fetch`（略過 git fetch）、
`--pretty`（彩色文字，否則 JSON）。`--preflight` 全數 ✅（exit 0）後才適合往後跑。

### 資料流

`computeFullAnalysis`（純運算）→ `buildReportModel`（唯一 model，可直接 JSON.stringify）→
`lib/render.js`（彩色 view，只消費 model）。JSON 與彩色輸出都從同一份 model 派生。
`lib/assess.js` 負責從 fix version 名稱推導 deadline / 緊急度，以及 ticket 完成度。

### fix version → deadline / 緊急度

從版本名判斷（大小寫不敏感）：
- 含 `hotfix` → 最緊急，deadline = 版本日
- 含 `Staging` → deadline = 版本日（當天上 staging）
- 皆無 → deadline = 版本日 − 7 天（前一週上 staging）

一張 ticket 取其**所有** fix version 中最急的當緊急度（含已逾期、視窗外的版本）。
緊急度分桶：`🔥 hotfix > 🔴 逾期 > 🟠 緊迫（urgentWithinDays 天內）> 🟢 餘裕`。

### 完成度（未完成 = 下列任一）

- Jira 狀態落在 `notDoneStatuses`（config）
- 任一對應 branch 未 merge 進 `dev` 或 `staging`
- 任一對應 branch 未 push / 本地領先未 push
- 任一對應 branch 未開 MR（opened / merged 皆算已開）
- 或完全找不到對應 branch（標「可能還沒開始」）

MR 未解決 discussions 不計入完成度，另列在報表最後的獨立區塊。
