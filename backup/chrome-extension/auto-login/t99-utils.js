import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

import { exec } from 'child_process'
import { CacheInstance, LoginNeeded } from './login-stuff.js'
import { blue, lightCyan, lightGreen, red } from '../color.js'

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

export async function loginDisposable(payload, { port = null } = {}) {
  generateNeededFolders()
  generateNeededFiles()
  const cache = generateCacheData()

  if (!(payload instanceof LoginNeeded)) {
    errorConsole('payload 需為 LoginNeeded 的實例!', payload)
    throw new Error('Invalid payload type')
  }

  // TODO(flyc): 這裡要有不使用 cache 的選項
  const currentUseCache = new CacheInstance(cache[payload.potentialPk], payload)

  payload.mergeCache(currentUseCache)

  const { error, token, websiteLink, isInProgress, inProgressTimestamp } = await payload.login()
  if (error != null) {
    if (isInProgress == null) return console.error('登入失敗: ', error)
    else {
      console.log('登入失敗，但有 isInProgress 的中間態, 將其狀態同步到 cache 檔案')
      currentUseCache.update({ ...payload, isInProgress, inProgressTimestamp })
      return
    }
  }

  // 更新存入 cache 等
  console.log()
  console.log(lightCyan('開始存入 Cache'))
  currentUseCache.update({ ...payload, token })
  cache[payload.potentialPk] = currentUseCache
  fs.writeFileSync(cacheFilePath, JSON.stringify(cache, null, 2), 'utf8')
  console.log('Cache 儲存成功')

  // 開啟瀏覽器的部分
  console.log()
  console.log(lightCyan('開啟瀏覽器..'))
  const url = port ? `http://localhost:${port}` : websiteLink
  let encodedCode = EncodeDecode.encode({ token, url }, 10)
  encodedCode = EncodeDecode.encode(encodedCode, 5)
  exec(`open '${exampleDomain}?_=${encodedCode}'`)

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
