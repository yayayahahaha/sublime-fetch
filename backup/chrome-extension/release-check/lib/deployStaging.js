// 「部署 brand 到 dev / staging」的 engine：從指定 repo 的固定 matrix 檔取出可部署清單。
// 這裡只做資料取得 + 嚴謹檢查，不含互動、不觸發 pipeline（觸發沿用 pipelineActions.triggerPipeline）。
//
// 部署固定條件（dev / staging 機制同構，見 frontend 的 .gitlab-ci.whitelabel.config.yml：
// `.parallel dev` / `.parallel staging` 都是 `$WHITELABEL_NAME == $RECIPE` + 限定各自分支）：
//   - branch：目標環境的同名分支（dev / staging）
//   - pipeline variable：type=Variable、key=RECIPE、value=選到的 WHITELABEL_NAME
//   - 選項來源：該分支裡的固定 matrix 檔
//     結構固定為 <rootKey>.parallel.matrix[].WHITELABEL_NAME

export const RECIPE_VAR_KEY = 'RECIPE'

export const DEPLOY_TARGETS = {
  staging: {
    key: 'staging',
    branch: 'staging',
    matrixFile: '.gitlab-ci.staging-whitelabel-matrix.config.yml',
    rootKey: '.staging-whitelabel-matrix',
    // 每個選項都要長成「<非空白><空白>staging」結尾，例如 "Btse staging"
    recipePattern: /[^\s]\sstaging$/,
    patternHint: '需符合 /[^\\s]\\sstaging$/',
  },
  dev: {
    key: 'dev',
    branch: 'dev',
    matrixFile: '.gitlab-ci.dev-whitelabel-matrix.config.yml',
    rootKey: '.dev-whitelabel-matrix',
    // dev 比照 staging 命名（例如 "Btse dev"），另有一個特殊項目 storybook 也是合法部署目標
    recipePattern: /^storybook$|[^\s]\sdev$/,
    patternHint: '需符合 /[^\\s]\\sdev$/（或 storybook）',
  },
}

const indentOf = (line) => line.length - line.trimStart().length

/**
 * 嚴謹地解析固定結構的 whitelabel matrix 檔，取出所有 WHITELABEL_NAME。
 * 只認 <rootKey> → parallel → matrix → list item 這個階層，
 * 結構對不上就回格式錯誤，不做寬鬆猜測。
 * 回 { ok:true, names:[...] } | { ok:false, error }
 */
export function parseWhitelabelMatrix(text, rootKey = DEPLOY_TARGETS.staging.rootKey) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, error: '檔案內容是空的' }
  }

  // 保留縮排，去掉行尾空白、空白行、整行註解
  const lines = text
    .split(/\r?\n/)
    .map((line, n) => ({ line: line.replace(/\s+$/, ''), n }))
    .filter(({ line }) => line.trim() !== '' && !/^\s*#/.test(line))

  // 1) 頂層 key（縮排 0）。行尾空白已被去掉，所以直接全等比對
  const root = lines.find(({ line }) => indentOf(line) === 0 && line === `${rootKey}:`)
  if (!root) return { ok: false, error: `找不到頂層 key「${rootKey}:」` }

  // root 底下的區塊：root 之後、下一個縮排 0 之前的所有行
  const after = lines.filter(({ n }) => n > root.n)
  const rootEndPos = after.findIndex(({ line }) => indentOf(line) === 0)
  const rootBlock = rootEndPos === -1 ? after : after.slice(0, rootEndPos)
  if (rootBlock.length === 0) return { ok: false, error: `「${rootKey}」底下沒有內容` }

  // 2) parallel:
  const parallel = rootBlock.find(({ line }) => /^\s*parallel:\s*$/.test(line))
  if (!parallel) return { ok: false, error: '缺少「parallel:」層' }
  const parallelBlock = rootBlock.filter(({ n, line }) => n > parallel.n && indentOf(line) > indentOf(parallel.line))

  // 3) matrix:
  const matrix = parallelBlock.find(({ line }) => /^\s*matrix:\s*$/.test(line))
  if (!matrix) return { ok: false, error: '缺少「matrix:」層' }
  const matrixBlock = parallelBlock.filter(({ n, line }) => n > matrix.n && indentOf(line) > indentOf(matrix.line))
  if (matrixBlock.length === 0) return { ok: false, error: 'matrix 底下沒有任何項目' }

  // 4) list item（以 - 開頭），每個 item 抓其 WHITELABEL_NAME
  const items = matrixBlock.filter(({ line }) => /^\s*-\s/.test(line))
  if (items.length === 0) return { ok: false, error: 'matrix 底下找不到任何 list item（- 開頭）' }

  const names = []
  for (let idx = 0; idx < items.length; idx++) {
    const start = items[idx].n
    const end = idx + 1 < items.length ? items[idx + 1].n : Infinity
    const itemBlock = matrixBlock.filter(({ n }) => n >= start && n < end)
    const hit = itemBlock
      .map(({ line }) => line.match(/^\s*(?:-\s+)?WHITELABEL_NAME:\s*(.+?)\s*$/))
      .find(Boolean)
    if (!hit) return { ok: false, error: `第 ${idx + 1} 個 matrix 項目缺少 WHITELABEL_NAME` }
    const value = hit[1].trim().replace(/^['"]|['"]$/g, '').trim()
    if (value === '') return { ok: false, error: `第 ${idx + 1} 個 matrix 項目的 WHITELABEL_NAME 是空的` }
    names.push(value)
  }

  return { ok: true, names }
}

/**
 * 取得指定環境可部署的 recipe 清單，逐層嚴謹檢查：
 *   1. repo 存不存在
 *   2. remote 目標分支存不存在
 *   3. 目標分支裡的 matrix 檔存不存在
 *   4. matrix 檔格式正不正確
 *   5. 每個選項是否符合該環境的 recipePattern
 * 任一層失敗即回 { ok:false, stage, error }；stage ∈ config|repo|branch|file|format|pattern
 * 成功回 { ok:true, recipes:[...], repoPath, branch, filePath }
 */
export async function loadDeployRecipes(gitlab, { repoPath, target = DEPLOY_TARGETS.staging } = {}) {
  const { branch, matrixFile: filePath, rootKey, recipePattern, patternHint } = target
  if (!repoPath) return { ok: false, stage: 'config', error: '未設定部署 repo（config.deploy.repo）' }
  const id = encodeURIComponent(repoPath)

  // 1) repo 存不存在
  try {
    await gitlab.request(`/projects/${id}`)
  } catch (err) {
    if (err.status === 404) return { ok: false, stage: 'repo', error: `repo 不存在或無權限存取：${repoPath}` }
    return { ok: false, stage: 'repo', error: `檢查 repo 失敗：${err.message}`, status: err.status }
  }

  // 2) remote 目標分支存不存在
  try {
    await gitlab.getBranch(repoPath, branch)
  } catch (err) {
    if (err.status === 404) return { ok: false, stage: 'branch', error: `remote 分支不存在：${branch}` }
    return { ok: false, stage: 'branch', error: `檢查分支「${branch}」失敗：${err.message}`, status: err.status }
  }

  // 3) 檔案存不存在（順便取內容）
  let content
  try {
    content = await gitlab.getFileRaw(repoPath, filePath, branch)
  } catch (err) {
    if (err.status === 404) return { ok: false, stage: 'file', error: `${branch} 分支裡找不到檔案：${filePath}` }
    return { ok: false, stage: 'file', error: `讀取檔案失敗：${err.message}`, status: err.status }
  }

  // 4) 格式正不正確
  const parsed = parseWhitelabelMatrix(content, rootKey)
  if (!parsed.ok) return { ok: false, stage: 'format', error: `${filePath} 格式錯誤：${parsed.error}` }

  // 5) 每個選項都要符合命名規則
  const invalid = parsed.names.filter((name) => !recipePattern.test(name))
  if (invalid.length > 0) {
    return {
      ok: false,
      stage: 'pattern',
      error: `以下 WHITELABEL_NAME 不符合命名規則（${patternHint}）：${invalid.join('、')}`,
      names: parsed.names,
      invalid,
    }
  }

  return { ok: true, recipes: parsed.names, repoPath, branch, filePath }
}
