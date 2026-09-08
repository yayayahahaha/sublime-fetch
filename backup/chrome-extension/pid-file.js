/*
  給 mock-server / otp-proxy 用的 pid 檔機制。

  目的：讓「啟動」跟「收尾」可以是不同的呼叫者（例如未來 agent 用 CLI 開，
  結束時另一個流程幫忙收尾），也能精準只砍「這個 pid 檔記錄的那個 process」，
  不會誤殺使用者手動另開、剛好用同個 port 的其他 process。

  檔案放在 chrome-extension/.pid/<name>-<port>.pid（*.pid 已經在 .gitignore）。
*/

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PID_DIR = fileURLToPath(new URL('./.pid', import.meta.url))

function pidFilePath(name, port) {
  return path.join(PID_DIR, `${name}-${port}.pid`)
}

/**
 * 在自己這個 process 成功綁定 port 之後呼叫。寫入 pid 檔，並在這個
 * process 結束時（正常 exit / Ctrl+C / 被 SIGTERM）自動清掉檔案——
 * 避免留下指向已經死掉 process 的孤兒檔案。
 *
 * @param {string} name  服務名稱，例如 'mock-server' / 'otp-proxy'
 * @param {number} port
 * @returns {string} 寫入的檔案路徑
 */
export function registerPidFile(name, port) {
  fs.mkdirSync(PID_DIR, { recursive: true })
  const filePath = pidFilePath(name, port)

  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        pid: process.pid,
        name,
        port,
        command: process.argv.slice(1).join(' '),
        startedAt: new Date().toISOString(),
      },
      null,
      2
    )
  )

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    try {
      // 只清「還是自己寫的那份」——如果內容的 pid 已經被後來的 process 蓋掉，
      // 代表這個 port 已經換人在用，不要動別人的檔案。
      const current = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      if (current.pid === process.pid) fs.unlinkSync(filePath)
    } catch {
      // 檔案本來就不在，或讀不到——不用管
    }
  }

  process.on('exit', cleanup)
  // 不能只掛 cleanup：process.on('SIGINT'/'SIGTERM', ...) 一旦被監聽，
  // Node 就不會再自動用預設行為結束 process，要自己 exit，
  // 否則（例如 hot reload）親 process 等的 child 'exit' 事件永遠不會 fire。
  process.on('SIGINT', () => {
    cleanup()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    cleanup()
    process.exit(0)
  })

  return filePath
}

/**
 * 收尾用：只砍「pid 檔裡記錄的那個 PID」，砍完順手刪檔。
 * pid 檔不存在、或裡面記錄的 process 早就不在了，都不算錯誤——視為「本來就沒開」。
 *
 * @param {string} name
 * @param {number} port
 * @returns {{ killed: boolean, pid?: number, reason?: string }}
 */
export function killRegisteredServer(name, port) {
  const filePath = pidFilePath(name, port)

  let record
  try {
    record = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return { killed: false, reason: 'no-pid-file' }
  }

  try {
    process.kill(record.pid, 'SIGTERM')
  } catch (e) {
    // ESRCH = 那個 pid 早就不在了（孤兒檔案），視為已經清乾淨
    try {
      fs.unlinkSync(filePath)
    } catch {
      // ignore
    }
    return { killed: false, reason: e.code === 'ESRCH' ? 'already-dead' : e.message }
  }

  return { killed: true, pid: record.pid }
}

// 直接執行這支檔案：node pid-file.js kill <name> <port>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , cmd, name, portArg] = process.argv
  if (cmd !== 'kill' || !name || !portArg) {
    console.error('用法: node pid-file.js kill <name> <port>')
    process.exit(1)
  }
  const result = killRegisteredServer(name, Number(portArg))
  console.log(result)
}
