// 寫入動作共用：把 API 例外轉成 { ok:false, error, status }，並友善化常見狀態碼。
export function toErrorResult(err) {
  const status = err?.status
  const base = err?.message ?? String(err)
  let hint = ''
  if (status === 401) hint = '（認證失敗）'
  else if (status === 403) hint = '（權限不足：token scope 或專案角色不夠）'
  else if (status === 404) hint = '（找不到：確認 project / branch / id）'
  else if (status === 409) hint = '（衝突：可能已存在）'
  return { ok: false, error: `${base}${hint}`, status }
}
