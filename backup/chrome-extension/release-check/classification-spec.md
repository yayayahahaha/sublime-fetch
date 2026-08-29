# Release Check — ticket 分類判定 spec（追蹤用）

> 目的：把「撈出來的 Jira ticket」分成三類。這份是**目標規格**，跟目前程式（checklist 模型）不完全一致，逐步遷移。
> 狀態標記：✅ 已定案　🟡 待討論　🔧 待實作

---

## 1. 三個分類

| 分類 | 意義 |
|---|---|
| **已完成** | 需求整個結束（Jira 標完成，且 code 真的進了 develop / doneBranches）|
| **已送測** | 已上 staging、送測中（merge 進 dev+staging、develop MR 已開）|
| **其他** | 連送測都還沒 —— 這就是我「需要去處理」的清單 |

判定順序：**先看 override（步驟 0）→ 再判已完成 → 再判已送測 → 都不中就是其他**。

## 2. 特殊場景（💥）

- 💥 **不用改 code、但仍需送測**：沒有 branch / MR，靠 Jira 狀態判定。
- 💥 **已 → develop、remote+local branch 都被砍**：沒 branch，靠 Jira 狀態（已完成）/ 或 key 補搜的 merged MR。
- 💥 **協作 base-branch**：my-branch → base-branch → develop。用 **`develop contains 該 branch tip`** 判定即可自然涵蓋（base-branch 有接上 develop 才會 contains），不需檢查 MR target。

---

## 3. 判定規則

### 步驟 0 — ⚠ 本地超前未 push → 其他 ✅（override，凌駕一切，最危險）

任一 branch `hasRemote && ahead > 0`（本地有 commit 未推）→ 直接「其他」+ 醒目警告。
情境：merge 後又改東西 / 忘記推。**不論 Jira 狀態。**

### 步驟 1 — 已完成？ ✅

**Jira 狀態是必要條件；git 只做驗證（develop 真的包含這個 branch）。**

```js
// 回傳 true = 已完成
if (jira 狀態 ∉ doneStatuses) return false          // Jira 狀態是必要條件
if (任一 repo 有 open MR) return false               // 有殘留 open MR → 未完成

const involvedRepos = 有 branch 的 repo（聚合看全部）
if (involvedRepos.length === 0) return true          // 沒 branch → 信 Jira（不用改 code / branch 已刪）

// 每個有 branch 的 repo 的每個 branch 都要：進了所有 doneBranch、且不是空 branch
for (const branch of 所有 involvedRepos 的 branch) {
  const tip = branch 的 remote tip（沒 remote 才用 local tip）
  if (doneBranches.some(db => tip === origin/db 的 head commit)) return false  // 空 branch 誤報 → 未完成
  if (!doneBranches.every(db => origin/db contains tip)) return false          // 還沒進 doneBranch
}
return true
```

要點：
- `doneBranches`（通常 `[develop]`，可多個）→ **每個都要 contains**。
- **空 branch 防呆**：branch tip 若等於任一 doneBranch 的 head commit（＝沒做事、tip 剛好落在 mainline 上）→ 判未完成。（flyc：這時我會去查「為什麼有這個 branch」，可接受）
- 協作 base-branch 由 `develop contains tip` 自然涵蓋，不需看 MR target。

### 步驟 2 — 已送測？ ✅

```js
if (有 remote branch) {
  // 顯示 MR 狀態
  const mergedStatus = 每個有 branch 的 repo 都 merge 進 dev+staging
                       （--contains dev,staging，且 branch tip ≠ dev/staging/develop 的 head → 擋空 branch）
  // 逐 repo：每個有 branch 的 repo 都要「送出過」（opened 或 merged 的 MR）。
  // 用 opened-or-merged（不是嚴格 open）→ 已 merged 的 repo 不會被誤殺；仍能抓「有 branch 卻完全沒 MR」。
  const submitted = 每個有 branch 的 repo 都有 ≥1 個 (opened|merged) 的 MR
  if (!mergedStatus || !submitted) return false
  if (有 submitted MR 的 target ≠ develop) 印警告
  return true
} else {
  // 沒 branch → 可能不用改 code
  if (jira 狀態 ∈ sentToTestStatuses) return true
  return false
}
```

> 「已送測 vs 已完成」的區別由步驟 1 那關負責（已完成需 doneStatus + 無 open MR + 進 develop）；
> 已送測只確認「每個 repo 都上 staging + 都送出過 MR」。所以「全 repo 都 merged 但 Jira 沒標完成」會落在**已送測**（合理：code 完了、只差 Jira）。

### 步驟 3 — 其他 ✅
以上都不中 → 其他（我要處理的清單）。

---

## 4. 多 repo 原則 ✅
- 已完成：`無 open MR`（聚合）、`每個有 branch 的 repo 的 branch 都進 doneBranches`（逐 repo）。
- 已送測：`每個有 branch 的 repo 都 merge 進 dev+staging`（逐 repo）、`每個有 branch 的 repo 都有 (opened|merged) MR`（逐 repo）。
- 「有 branch 卻完全沒 MR 的 repo」→ 送測那關 fail → 落到其他（＝還沒送出）。
- 沒 branch 的 repo → 略過（不用改 code，不影響判定）。

## 5. 分支操作一律以 remote 為主 ✅
- `contains` 看 `origin/dev`、`origin/staging`、`origin/develop`；tip 取 remote 為主（remoteRef ?? localRef）。
- **唯一例外**：步驟 0「本地超前未 push」＝ local vs `origin/<同名>`。

## 6. Config 狀態清單（重新整理）🔧
| 欄位 | 用途 |
|---|---|
| `doneStatuses` | Jira 狀態 → 已完成（必要條件）|
| `sentToTestStatuses` | Jira 狀態 → 已送測（沒 branch 時的 fallback）|

> 取代舊的 `stagingDoneStatuses` / `stagingNotDoneStatuses`。

---

## 🟡 待討論
1. ~~步驟 1 vs branch-沒-MR 例外的先後~~ → 已解決：已完成以 Jira 狀態為必要條件，git 驗證 develop contains。
2. ~~已送測（步驟 2）細節~~ → 已解決：逐 repo、submitted = (opened|merged) MR。

## 🔧 TODO（實作）
- [x] config：`doneStatuses` / `sentToTestStatuses` 兩份（改名 + `.default` + loader）
- [x] `analyzeBranch`：記錄 branch tip 是否等於各 check branch 的 head commit（`tipIsHeadOf`，空 branch 防呆）
- [x] `assess.js`：`classifyTicket` 步驟 0 → 已完成 → 已送測 → 其他
- [x] 步驟 0 未 push override（`hasRemote && ahead > 0`）+ 醒目警告
- [x] 步驟 1 已完成：doneStatus 必要 + 無 open MR + 每 branch 進 doneBranches + 空 branch 防呆
- [x] 步驟 2 已送測：逐 repo（都上 staging + 都有 opened|merged MR）；MR target 非 dev/staging/develop → 警告；顯示 MR 狀態
- [x] branch key 比對改成「有邊界」（避免 `PLAT-1` 誤中 `PLAT-10`）
- [x] `render.js`：三分類呈現（其他/已送測/已完成）+ 各步驟原因/警告文字
- [ ] 用實際 log / 實跑驗證幾個既有場景（flyc）
