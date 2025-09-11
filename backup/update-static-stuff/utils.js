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

export function isDir(path) {
  if (!fs.existsSync(path)) return false
  return fs.lstatSync(path).isDirectory()
}

export function checkSetting(setting) {
  let {
    'frontend-repo-path': frontendRepoPath,
    's3-repo-path': s3RepoPath,
    'new-images-folder': newImagesFolder,
    'figma-images-folders': figmaImagesFolders,
    'target-brand': targetBrand,
  } = setting

  let ok = true

  if (typeof frontendRepoPath !== 'string') {
    consoleRed('frontendRepoPath 需為 string!')
    frontendRepoPath = null
    ok = false
  } else if (frontendRepoPath.match(/\//) == null) {
    consoleRed('frontendRepoPath 需為絕對路徑!')
    frontendRepoPath = null
    ok = false
  }

  if (typeof s3RepoPath !== 'string') {
    consoleRed('s3RepoPath 需為 string!')
    s3RepoPath = null
    ok = false
  } else if (s3RepoPath.match(/\//) == null) {
    consoleRed('s3RepoPath 需為絕對路徑!')
    s3RepoPath = null
    ok = false
  }

  if (typeof newImagesFolder !== 'string') {
    consoleRed('newImagesFolder 需為 string!')
    newImagesFolder = null
    ok = false
  } else if (newImagesFolder.match(/^\./) == null) {
    consoleRed('newImagesFolder 需為相對路徑!')
    newImagesFolder = null
    ok = false
  }

  if (typeof figmaImagesFolders !== 'string') {
    consoleRed('figmaImagesFolders 需為 string!')
    figmaImagesFolders = null
    ok = false
  } else if (figmaImagesFolders.match(/^\./) == null) {
    consoleRed('figmaImagesFolders 需為相對路徑!')
    figmaImagesFolders = null
    ok = false
  }

  let targetBrandExist = true
  if (typeof targetBrand !== 'string') {
    consoleRed('targetBrand 需為 string!')
    targetBrand = null
    ok = false
    targetBrandExist = false
  }
  if (targetBrandExist) {
    if (frontendRepoPath != null) {
      const brandPath = path.resolve(frontendRepoPath, 'src', `brand-${targetBrand}`)
      if (!fs.existsSync(brandPath)) {
        consoleRed(`targetBrand "${targetBrand}" 不存在於 ${brandPath}`)
        targetBrand = null
        ok = false
      }
    }

    if (s3RepoPath != null) {
      const s3BrandPath = path.resolve(s3RepoPath, targetBrand)
      if (!fs.existsSync(s3BrandPath)) {
        consoleRed(`targetBrand "${targetBrand}" 不存在於 ${s3BrandPath}`)
        targetBrand = null
        ok = false
      }
    }
  }

  return { ok, frontendRepoPath, s3RepoPath, newImagesFolder, figmaImagesFolders, targetBrand }
}

export function consoleRed(message) {
  console.log(`\x1b[31m${message}\x1b[0m`)
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
