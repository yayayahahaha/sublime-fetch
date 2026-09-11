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

/**
 * 解析並驗證要用哪個 brand。
 *
 * 消費端自己驗證參數的正確性: 不管 targetBrand 是從 setting.json 讀到的、還是呼叫端直接寫死傳進來的,
 * 都要在這裡驗證它是否真的存在於 frontendRepoPath / s3RepoPath 底下, 不會因為「有給值就相信它」而漏檢查。
 * 沒給 targetBrand 才會跳互動選單, 選出來的一樣會驗證 s3RepoPath 那邊 (frontend 那邊天生就存在, 因為是從那個資料夾列出來的)。
 */
export async function resolveBrand({ targetBrand = null, frontendRepoPath, s3RepoPath } = {}) {
  if (targetBrand != null) {
    if (frontendRepoPath != null) {
      const brandPath = path.resolve(frontendRepoPath, 'src', `${BRAND_PREFIX}${targetBrand}`)
      if (!isDir(brandPath)) {
        consoleRed(`target-brand "${targetBrand}" 不存在於 ${brandPath}`)
        return null
      }
    }
    if (s3RepoPath != null) {
      const s3BrandPath = path.resolve(s3RepoPath, targetBrand)
      if (!fs.existsSync(s3BrandPath)) {
        consoleRed(`target-brand "${targetBrand}" 不存在於 ${s3BrandPath}`)
        return null
      }
    }
    return targetBrand
  }

  if (frontendRepoPath == null) {
    consoleRed('需要 frontend-repo-path 才能挑選 brand (或直接提供 target-brand)')
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
