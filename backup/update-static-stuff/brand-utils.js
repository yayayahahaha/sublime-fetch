import path from 'path'
import fs from 'fs'
import select from '@inquirer/select'
import { consoleRed, isDir } from './utils.js'

const BRAND_PREFIX = 'brand-'

export async function pickBrand(frontendRepoPath) {
  const brandsRoot = path.resolve(frontendRepoPath, 'src')
  if (!isDir(brandsRoot)) {
    consoleRed(`${brandsRoot} 不為資料夾!`)
    return null
  }

  const brands = fs
    .readdirSync(brandsRoot)
    .filter((name) => name.startsWith(BRAND_PREFIX) && isDir(path.resolve(brandsRoot, name)))
    .map((name) => name.slice(BRAND_PREFIX.length))
    .filter((name) => name.length > 0)
    .sort()

  if (brands.length === 0) {
    consoleRed(`${brandsRoot} 底下找不到 ${BRAND_PREFIX}* 資料夾!`)
    return null
  }

  return await select({
    message: '請選擇 target-brand:',
    choices: brands.map((b) => ({ name: b, value: b })),
    loop: false,
    pageSize: Math.min(Math.max(brands.length, 5), 20),
  }).catch(() => null)
}

export async function resolveBrand({ settingBrand, frontendRepoPath, s3RepoPath } = {}) {
  if (settingBrand != null) return settingBrand

  if (frontendRepoPath == null) {
    consoleRed('需要 frontend-repo-path 才能挑選 brand (或在 setting.json 設定 target-brand)')
    return null
  }

  const picked = await pickBrand(frontendRepoPath)
  if (picked == null) {
    consoleRed('未選擇 brand')
    return null
  }

  if (s3RepoPath != null) {
    const s3BrandPath = path.resolve(s3RepoPath, picked)
    if (!fs.existsSync(s3BrandPath)) {
      consoleRed(`brand "${picked}" 不存在於 ${s3BrandPath}`)
      return null
    }
  }

  return picked
}
