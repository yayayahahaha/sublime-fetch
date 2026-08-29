// 共用的 logging helpers — server.js (HTTP) 和 ws/router.js (WebSocket) 都會用
export const ts = () => new Date().toTimeString().slice(0, 8) // HH:MM:SS
export const pad = (str, n) => String(str).padEnd(n, ' ')

// ANSI colors — 自動偵測 TTY，pipe 到 file 時自動退化成純文字
const useColors = process.stdout.isTTY
const wrap = (code) => (s) => (useColors ? `\x1b[${code}m${s}\x1b[0m` : `${s}`)
export const dim = wrap('2')
export const red = wrap('31')
export const green = wrap('32')
export const yellow = wrap('33')
export const cyan = wrap('36')
