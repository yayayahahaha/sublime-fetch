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

/**
 * 依時間窗篩選版本。窗為 [今天 00:00, 今天 + daysAhead 23:59]。
 * 回傳含解析日期的版本，依日期由近到遠排序。
 */
export function selectVersionsInWindow(versions, { today = new Date(), daysAhead = 30, customRegex = null } = {}) {
  const start = new Date(today)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + daysAhead)
  end.setHours(23, 59, 59, 999)

  return (versions ?? [])
    .map((v) => ({ ...v, releaseDate: extractVersionDate(v.name, customRegex) }))
    .filter((v) => v.releaseDate && v.releaseDate >= start && v.releaseDate <= end)
    .sort((a, b) => a.releaseDate - b.releaseDate)
}
