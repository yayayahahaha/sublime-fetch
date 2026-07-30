// 從 fix version 名稱抽出日期，並依「今天 + 往後 N 天」的時間窗篩選版本。
// 版本名稱中一定會有 8 碼 YYYYMMDD 的日期欄位（可用 config.dateTokenRegex 覆寫抽法）。

// 把 YYYYMMDD 解析成本地時區的當天 00:00 Date；不合法回傳 null。
function parseYmd(y, mo, d) {
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const date = new Date(y, mo - 1, d)
  // 防 2026-02-31 這種假日期
  if (date.getMonth() !== mo - 1 || date.getDate() !== d) return null
  date.setHours(0, 0, 0, 0)
  return date
}

/**
 * 從版本名稱抽出日期。
 * - 預設：掃描所有 8 碼數字，取第一個能組成合法 YYYYMMDD 的。
 * - 若給 customRegex：用它比對，第 1 個 capture group 應為 8 碼 YYYYMMDD。
 * 回傳 Date 或 null。
 */
export function extractVersionDate(name, customRegex = null) {
  if (!name) return null
  const str = String(name)

  if (customRegex) {
    const match = str.match(new RegExp(customRegex))
    const token = match && (match[1] ?? match[0])
    if (!token || !/^\d{8}$/.test(token)) return null
    return parseYmd(+token.slice(0, 4), +token.slice(4, 6), +token.slice(6, 8))
  }

  const tokens = str.match(/\d{8}/g)
  if (!tokens) return null
  for (const token of tokens) {
    const date = parseYmd(+token.slice(0, 4), +token.slice(4, 6), +token.slice(6, 8))
    if (date) return date
  }
  return null
}

function fmtYmd(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 解析「時間窗」輸入，支援兩種格式：
 *  - 純數字天數（如 `30`）→ { kind: 'days', daysAhead }
 *  - 8 碼日期區間（如 `20260101-20260110`，固定用 `-` 連接）→ { kind: 'range', start, end }
 * 空字串則套用 fallbackDays。
 * 回傳 { ok: true, window } 或 { ok: false, error }（error 為給使用者的提示字串）。
 */
export function parseFixVersionWindow(raw, { fallbackDays = 30 } = {}) {
  const s = String(raw ?? '').trim()
  if (s === '') return { ok: true, window: { kind: 'days', daysAhead: fallbackDays } }
  if (/^\d+$/.test(s)) return { ok: true, window: { kind: 'days', daysAhead: Number(s) } }

  const m = s.match(/^(\d{8})-(\d{8})$/)
  if (m) {
    const start = parseYmd(+m[1].slice(0, 4), +m[1].slice(4, 6), +m[1].slice(6, 8))
    const end = parseYmd(+m[2].slice(0, 4), +m[2].slice(4, 6), +m[2].slice(6, 8))
    if (!start || !end) return { ok: false, error: '日期不合法，需為有效的 YYYYMMDD（如 20260101-20260110）' }
    if (start > end) return { ok: false, error: '起始日期不能晚於結束日期' }
    return { ok: true, window: { kind: 'range', start, end } }
  }
  return { ok: false, error: '格式需為天數（如 30）或日期區間（如 20260101-20260110）' }
}

// 把 window 轉成給人看的標籤（供標題/訊息顯示）。
export function describeWindow(window) {
  if (!window) return ''
  if (window.kind === 'range') return `${fmtYmd(window.start)} ~ ${fmtYmd(window.end)}`
  return `往後 ${window.daysAhead} 天`
}

/**
 * 依時間窗篩選版本。window 可為：
 *  - { kind: 'days', daysAhead }：窗為 [今天 00:00, 今天 + daysAhead 23:59]
 *  - { kind: 'range', start, end }：窗為 [start 00:00, end 23:59]
 * 為相容舊呼叫，未給 window 時退回用 daysAhead 參數。
 * 回傳含解析日期的版本，依日期由近到遠排序。
 */
export function selectVersionsInWindow(versions, { today = new Date(), daysAhead = 30, customRegex = null, window = null } = {}) {
  const win = window ?? { kind: 'days', daysAhead }

  let start
  let end
  if (win.kind === 'range') {
    start = new Date(win.start)
    start.setHours(0, 0, 0, 0)
    end = new Date(win.end)
    end.setHours(23, 59, 59, 999)
  } else {
    start = new Date(today)
    start.setHours(0, 0, 0, 0)
    end = new Date(start)
    end.setDate(end.getDate() + (win.daysAhead ?? 30))
    end.setHours(23, 59, 59, 999)
  }

  return (versions ?? [])
    .map((v) => ({ ...v, releaseDate: extractVersionDate(v.name, customRegex) }))
    .filter((v) => v.releaseDate && v.releaseDate >= start && v.releaseDate <= end)
    .sort((a, b) => a.releaseDate - b.releaseDate)
}
