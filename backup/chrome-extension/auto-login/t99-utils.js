import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

import { exec } from 'child_process'
import { CacheInstance, LoginNeeded } from './login-stuff.js'
import { loadSettings } from './settings-loader.js'
import { blue, lightCyan, lightGreen, lightMagenta, red } from '../color.js'

// 目前先用複製的
export class EncodeDecode {
  static spliceLength = 10

  static genRegexp(spliceLength) {
    return new RegExp(`^.{${spliceLength}}`)
  }

  static replaceReverse(str, spliceLength) {
    return str.replace(EncodeDecode.genRegexp(spliceLength), (match) => {
      return match.split('').reverse().join('')
    })
  }

  static encode(payload, spliceLength = EncodeDecode.spliceLength) {
    return EncodeDecode.replaceReverse(btoa(JSON.stringify(payload)), spliceLength)
  }

  static decode(payload, spliceLength = EncodeDecode.spliceLength) {
    return JSON.parse(atob(EncodeDecode.replaceReverse(payload, spliceLength)))
  }
}

const exampleDomain = 'https://www.google.com/'
const cacheFolder = path.resolve(dirname, 'cache')
const cacheFilePath = path.resolve(cacheFolder, 'cache.json')

function generateNeededFolders() {
  if (!fs.existsSync(cacheFolder)) {
    fs.mkdirSync(cacheFolder, { recursive: true })
  }
}

function generateNeededFiles() {
  if (!fs.existsSync(cacheFilePath)) {
    fs.writeFileSync(cacheFilePath, JSON.stringify({}), 'utf8')
  }
}

function generateCacheData() {
  if (!fs.existsSync(cacheFilePath)) return {}

  try {
    return JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'))
  } catch (error) {
    console.log(red('解析 cache 檔案失敗: ', error))
    return {}
  }
}

// 共用的「合併既有 cache (deviceFingerprint/token) 後登入, 成功就存回 cache」邏輯。
// 除了 loginDisposable 之外, 其他不需要開瀏覽器、只是要拿 token 的流程 (例如 2fa-profile-helper.js)
// 也該透過這個函式登入, 才能吃到 healthCheck、避免每次都重新觸發 device OTP / 2FA
// TODO(flyc): 這裡要有不使用 cache 的選項
export async function loginWithCache(payload) {
  generateNeededFolders()
  generateNeededFiles()
  const cache = generateCacheData()

  if (!(payload instanceof LoginNeeded)) {
    errorConsole('payload 需為 LoginNeeded 的實例!', payload)
    throw new Error('Invalid payload type')
  }

  const currentUseCache = new CacheInstance(cache[payload.potentialPk], payload)
  payload.mergeCache(currentUseCache)

  const { error, token, websiteLink, isInProgress, inProgressTimestamp } = await payload.login()
  if (error != null) {
    if (isInProgress != null) {
      console.log('登入失敗，但有 isInProgress 的中間態, 將其狀態同步到 cache 檔案')
      currentUseCache.update({ ...payload, isInProgress, inProgressTimestamp })
    }
    return { error, isInProgress, inProgressTimestamp }
  }

  // 更新存入 cache 等
  console.log()
  console.log(lightCyan('開始存入 Cache'))
  currentUseCache.update({ ...payload, token })
  cache[payload.potentialPk] = currentUseCache
  fs.writeFileSync(cacheFilePath, JSON.stringify(cache, null, 2), 'utf8')
  console.log('Cache 儲存成功')

  return { token, websiteLink }
}

export async function loginDisposable(payload, { port = null } = {}) {
  const { error, token, websiteLink, isInProgress } = await loginWithCache(payload)
  if (error != null) {
    if (isInProgress == null) return console.error('登入失敗: ', error)
    return
  }

  // 讀取設定判斷是否使用 extension
  const settings = loadSettings()
  const useExtension = settings.useExtension ?? true

  console.log()
  console.log(blue('⚙️  讀取到的設定:'), { useExtension: settings.useExtension })
  console.log(blue('🚀 最終判定模式:'), useExtension ? 'Extension 模式' : '手動模式 (Console 貼上)')

  // 開啟瀏覽器的部分
  console.log()
  console.log(lightCyan('開啟瀏覽器..'))
  const url = port ? `http://localhost:${port}` : websiteLink

  if (useExtension) {
    let encodedCode = EncodeDecode.encode({ token, url }, 10)
    encodedCode = EncodeDecode.encode(encodedCode, 5)
    exec(`open '${exampleDomain}?_=${encodedCode}'`)
  } else {
    // 手動模式
    const manualScript = `localStorage.clear(); localStorage.setItem('token', '${token}'); location.reload();`

    console.log(lightMagenta('--------------------------------------------------'))
    console.log(lightMagenta('請在瀏覽器 Console 執行以下指令：'))
    console.log()
    console.log(manualScript)
    console.log()
    console.log(lightMagenta('--------------------------------------------------'))

    // 自動複製到剪貼簿 (macOS)
    try {
      const copyProcess = exec('pbcopy')
      copyProcess.stdin.write(manualScript)
      copyProcess.stdin.end()
      console.log(lightGreen('📋 已將指令自動複製到剪貼簿！'))
    } catch (e) {
      console.log(red('無法自動複製到剪貼簿'))
    }

    exec(`open '${url}'`)
  }

  console.log(lightGreen('\n 🌠 結束囉'))
}

// 看能不能有不需要 JSON.stringify 的寫法
export function errorConsole(...params) {
  console.log(...params.map((str) => red(typeof str === 'object' ? JSON.stringify(str) : str)))
}

export function warnConsole(...params) {
  console.log(`\x1b[1m\x1b[33m`, ...params, `\x1b[0m`)
}

export function titleConsole(...params) {
  console.log(`\x1b[1m\x1b[34m`, ...params, `\x1b[0m`)
}

// 看能不能有不需要 JSON.stringify 的寫法
export function subTitleConsole(...params) {
  console.log(...params.map((str) => blue(typeof str === 'object' ? JSON.stringify(str) : str)))
}

export function tokenConsole(str, token) {
  console.log(`💖 ${str}: `, '\x1b[1m\x1b[43m', token, '\x1b[0m')
}
