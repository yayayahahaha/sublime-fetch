import path from 'path'
import fs from 'fs'
import { imageSizeFromFile } from 'image-size/fromFile'

const SETTING_FILE_NAME = 'setting.json'
const SETTING_FILE_PATH = path.resolve('./', SETTING_FILE_NAME)

export function getSize(path) {
  return imageSizeFromFile(path)
}

export function readFilesRecursively(pathStr, list = []) {
  fs.readdirSync(pathStr).forEach((name) => {
    const fullPath = path.join(pathStr, name)
    isDir(fullPath) ? readFilesRecursively(fullPath, list) : list.push(fullPath)
  })
  return list
}

// 遞迴讀取資料夾, 回傳以檔名 (含 ext) 為 key 的 map
export function readFilesMapByName(dirPath) {
  return Object.fromEntries(
    readFilesRecursively(dirPath).map((filePath) => {
      const { base, ...others } = path.parse(filePath)
      return [base, { base, ...others, filePath }]
    })
  )
}

export function isDir(path) {
  if (!fs.existsSync(path)) return false
  return fs.lstatSync(path).isDirectory()
}

export function ensureDir(dirPath) {
  if (isDir(dirPath)) return false
  fs.mkdirSync(dirPath, { recursive: true })
  consoleGreen(`📁 已建立資料夾: ${dirPath}`)
  return true
}

// 寫入的當下才建立資料夾, 避免檢查階段就產生副作用
export function copyFileEnsureDir(sourcePath, targetPath) {
  ensureDir(path.dirname(targetPath))
  fs.copyFileSync(sourcePath, targetPath)
}

const SETTING_KEYS = {
  'frontend-repo-path': { type: 'absolutePath', camel: 'frontendRepoPath' },
  's3-repo-path': { type: 'absolutePath', camel: 's3RepoPath' },
  'new-images-folder': { type: 'relativePath', camel: 'newImagesFolder' },
  'figma-images-folders': { type: 'relativePath', camel: 'figmaImagesFolders' },
  // target-brand 是 optional: 沒設就會在 runtime 用 selector 從 frontend repo 挑
  'target-brand': { type: 'string', camel: 'targetBrand', optional: true },
}

export function checkSetting(setting, requiredKeys) {
  if (!Array.isArray(requiredKeys)) {
    consoleRed('checkSetting: requiredKeys 需為 array!')
    return { ok: false }
  }

  const result = {
    ok: true,
    frontendRepoPath: null,
    s3RepoPath: null,
    newImagesFolder: null,
    figmaImagesFolders: null,
    targetBrand: null,
  }

  for (const key of requiredKeys) {
    const meta = SETTING_KEYS[key]
    if (meta == null) {
      consoleRed(`checkSetting: 未知的 key "${key}"`)
      result.ok = false
      continue
    }

    const val = setting[key]
    if (val == null && meta.optional) {
      continue
    }
    if (typeof val !== 'string') {
      consoleRed(`${key} 需為 string!`)
      result.ok = false
      continue
    }
    if (meta.type === 'absolutePath' && val.match(/\//) == null) {
      consoleRed(`${key} 需為絕對路徑!`)
      result.ok = false
      continue
    }
    if (meta.type === 'relativePath' && val.match(/^\./) == null) {
      consoleRed(`${key} 需為相對路徑!`)
      result.ok = false
      continue
    }

    result[meta.camel] = val
  }

  return result
}

// 消費端 (實際做事的 function) 用: 檢查呼叫端傳進來的參數是不是非空字串。
// 這跟 checkSetting 不同 —— checkSetting 是 interface 層讀 setting.json 時的淺層檢查,
// 這個是消費端自己收到參數時的防呆, 不管參數是從 setting.json、互動選單、還是其他腳本硬寫死傳進來的都要過。
export function requireParams(params, keys) {
  let ok = true
  keys.forEach((key) => {
    if (typeof params[key] !== 'string' || params[key].trim() === '') {
      consoleRed(`缺少必要參數 "${key}"!`)
      ok = false
    }
  })
  return ok
}

export function consoleRed(message) {
  console.log(`\x1b[31m${message}\x1b[0m`)
}
export function consoleYellow(message) {
  console.log(yellow(message))
}
export function consoleGreen(message) {
  console.log(green(message))
}
export function consoleStep(message) {
  console.log(`檢查 ${message} : ${green('✅')}`)
}
export function consolePathHint({ sourceLines = [], targetLines = [] } = {}) {
  console.log()
  if (sourceLines.length > 0) {
    console.log(`📂 來源檔案請放置於:`)
    sourceLines.forEach((line) => console.log(`   ${line}`))
  }
  if (targetLines.length > 0) {
    console.log(`📁 將輸出到:`)
    targetLines.forEach((line) => console.log(`   ${line}`))
  }
  console.log()
}
export function green(msg) {
  return `\x1b[32m${msg}\x1b[0m`
}
export function lightGreen(msg) {
  return `\x1b[1m\x1b[32m${msg}\x1b[0m`
}
export function yellow(msg) {
  return `\x1b[33m${msg}\x1b[0m`
}
export function lightYellow(msg) {
  return `\x1b[1m\x1b[33m${msg}\x1b[0m`
}


export function high(msg) {
  const hStart = '\x1b[34m'
  const hEnd = '\x1b[0m'
  return `${hStart}${msg}${hEnd}`
}

export function readSetting() {
  try {
    const content = fs.readFileSync(SETTING_FILE_PATH, 'utf8')
    return parseJson(content)
  } catch (e) {
    consoleRed('readSetting: 讀取 setting.json 失敗!')
    console.log(e)
    return null
  }
}

export function parseJson(jsonStr) {
  try {
    return JSON.parse(jsonStr)
  } catch {
    consoleRed('parseJson: JSON.parse 失敗!')
    return null
  }
}

// 這個不一定有
export const ASSETS_IMAGES = [
  {
    filename: 'rocket.png',
    size: {
      width: 342,
      height: 232,
    },
    nameInFigma: 'icon & assets 底下',
    ext: '.png',
    path: 'assets',
  },
  {
    filename: 'earth.png',
    size: {
      width: 342,
      height: 232,
    },
    nameInFigma: 'icon & assets 底下',
    ext: '.png',
    path: 'assets',
  },
  {
    filename: 'coins.png',
    size: {
      width: 342,
      height: 232,
    },
    nameInFigma: 'icon & assets 底下',
    ext: '.png',
    path: 'assets',
  },
]
