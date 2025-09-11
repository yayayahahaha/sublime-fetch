import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

import { exec } from 'child_process'
import { CacheInstance, LoginNeeded } from './login-stuff.js'

// 目前先用複製的
class EncodeDecode {
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

const exampleDomain = 'https://example.com'
const cacheFolder = path.resolve(dirname, 'cache')
const cacheFile = path.resolve(cacheFolder, 'cache.json')

function generateNeededFolders() {
  if (!fs.existsSync(cacheFolder)) {
    fs.mkdirSync(cacheFolder, { recursive: true })
  }
}

function generateNeededFiles() {
  if (!fs.existsSync(cacheFile)) {
    fs.writeFileSync(cacheFile, JSON.stringify({}), 'utf8')
  }
}

function generateCacheData() {
  if (!fs.existsSync(cacheFile)) return {}

  try {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
  } catch (e) {
    console.error('Failed to parse cache file:', e)
    return {}
  }
}

export async function loginDisposable(payload, { port = null } = {}) {
  generateNeededFolders()
  generateNeededFiles()
  const cache = generateCacheData()

  if (!(payload instanceof LoginNeeded)) {
    console.error('Payload must be an instance of LoginNeeded')
    throw new Error('Invalid payload type')
  }

  // TODO(flyc): 這裡要有不使用 cache 的選項
  const currentUseCache = new CacheInstance(cache[payload.potentialPk])

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

  currentUseCache.update({ ...payload, token })
  cache[payload.potentialPk] = currentUseCache
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), 'utf8')
  const url = port ? `http://localhost:${port}` : websiteLink

  let encodedCode = EncodeDecode.encode({ token, url }, 10)
  encodedCode = EncodeDecode.encode(encodedCode, 5)
  exec(`open '${exampleDomain}?_=${encodedCode}'`)
}

export function errorConsole(...params) {
  console.log(`\x1b[1m\x1b[31m`, ...params, `\x1b[0m`)
}

export function warnConsole(...params) {
  console.log(`\x1b[1m\x1b[33m`, ...params, `\x1b[0m`)
}

export function titleConsole(...params) {
  console.log(`\x1b[1m\x1b[34m`, ...params, `\x1b[0m`)
}

export function subTitleConsole(...params) {
  console.log(`\x1b[34m`, ...params, `\x1b[0m`)
}

export function tokenConsole(str, token) {
  console.log(`💖 ${str}: `, '\x1b[1m\x1b[43m', token, '\x1b[0m')
}
