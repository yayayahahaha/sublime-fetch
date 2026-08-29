// 桌面通知：macOS 用內建 osascript（不需安裝額外套件）。回 { ok } | { ok:false, error }
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export async function notifyDesktop(title, message, { sound = 'Ping' } = {}) {
  if (process.platform !== 'darwin') {
    return { ok: false, error: `桌面通知目前只支援 macOS（當前平台：${process.platform}）` }
  }
  const esc = (s) => String(s).replace(/["\\]/g, '\\$&')
  const script = `display notification "${esc(message)}" with title "${esc(title)}"${sound ? ` sound name "${esc(sound)}"` : ''}`
  try {
    await execFileAsync('osascript', ['-e', script])
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err?.stderr || err?.message || String(err)).trim() }
  }
}
