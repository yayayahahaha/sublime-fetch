// 動態載入 mocks/ 底下的 HTTP mock 模組。兩種模組型態：
//   - 手寫 <name>.js        → export default function register(app, ctx)（有邏輯 / tamper 用）
//   - 宣告式 <name>.mock.json → { routes: [...] }，由通用 builder 轉成 register（快速 respond mock）
// 模組名 = 檔名去副檔名。新增模組 = 在 mocks/ 丟一個檔即可（不用回 server.js 補 import）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDeclarativeRegister } from './mocks/_helpers.js'

const MOCKS_DIR = fileURLToPath(new URL('./mocks/', import.meta.url))
const DECL_EXT = '.mock.json'

// 掃 mocks/：*.js（跳過 _ 開頭的共用檔）與 *.mock.json 都算模組，回傳排序後、去重的模組名。
export function listMockNames() {
  let entries
  try {
    entries = fs.readdirSync(MOCKS_DIR, { withFileTypes: true })
  } catch {
    return []
  }
  const names = new Set()
  for (const e of entries) {
    if (!e.isFile() || e.name.startsWith('_')) continue
    if (e.name.endsWith(DECL_EXT)) names.add(e.name.slice(0, -DECL_EXT.length))
    else if (e.name.endsWith('.js')) names.add(e.name.slice(0, -'.js'.length))
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

// 載入指定的模組。.js → import default function；.mock.json → 讀 spec 建 register。
// 回傳 [{ name, register }]；任何模組壞掉 / 找不到 / 同名衝突就直接 throw（fail-fast，附檔名）。
export async function loadSelectedMocks(names) {
  const loaded = []
  for (const name of names) {
    const jsPath = path.join(MOCKS_DIR, `${name}.js`)
    const jsonPath = path.join(MOCKS_DIR, `${name}${DECL_EXT}`)
    const hasJs = fs.existsSync(jsPath)
    const hasJson = fs.existsSync(jsonPath)

    if (hasJs && hasJson) {
      throw new Error(`mock 模組名衝突：同時有 ${name}.js 和 ${name}${DECL_EXT}，請刪掉其一`)
    }

    if (hasJson) {
      let spec
      try {
        spec = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
      } catch (err) {
        throw new Error(`宣告式 mock ${name}${DECL_EXT} JSON 解析失敗：${err.message}`)
      }
      loaded.push({ name, register: buildDeclarativeRegister(spec, { dir: MOCKS_DIR }) })
    } else if (hasJs) {
      const url = new URL(`./mocks/${name}.js`, import.meta.url)
      let mod
      try {
        mod = await import(url.href)
      } catch (err) {
        throw new Error(`mock 模組載入失敗 (${name}.js): ${err.message}`)
      }
      if (typeof mod.default !== 'function') {
        throw new Error(`mock 模組 ${name}.js 的 export default 必須是 function（register(app, ctx)）`)
      }
      loaded.push({ name, register: mod.default })
    } else {
      throw new Error(`找不到 mock 模組：${name}（mocks/ 下沒有 ${name}.js 或 ${name}${DECL_EXT}）`)
    }
  }
  return loaded
}

// 把載入的模組掛到 app 上，並偵測「選到的模組之間」有沒有宣告同一條 route（method + path）。
// 有衝突就 throw（避免 Express 靜默地讓其中一個蓋掉另一個）。回傳掛上的 route key 清單。
export function mountMocks(app, loaded, ctx = {}) {
  const owner = new Map() // "METHOD /path" -> 第一個宣告它的模組名
  const conflicts = []
  const ROUTE_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'use'])

  for (const { name, register } of loaded) {
    // 用 proxy 包住 app，記錄這個模組註冊了哪些 method + path
    const recorder = new Proxy(app, {
      get(target, prop, receiver) {
        const orig = Reflect.get(target, prop, receiver)
        if (typeof orig !== 'function') return orig
        if (ROUTE_METHODS.has(prop)) {
          return (...args) => {
            // 只在「有 path 字串 + 至少帶一個 handler/middleware」時記錄，避免誤記 app.get('setting') 這種設定讀取
            if (typeof args[0] === 'string' && args.length >= 2) {
              const key = `${prop.toUpperCase()} ${args[0]}`
              if (owner.has(key)) conflicts.push({ key, a: owner.get(key), b: name })
              else owner.set(key, name)
            }
            return orig.apply(target, args)
          }
        }
        return orig.bind(target)
      },
    })
    register(recorder, ctx)
  }

  if (conflicts.length) {
    const lines = conflicts.map((c) => `  ${c.key} — ${c.a} vs ${c.b}`).join('\n')
    throw new Error(`mock 路徑衝突（同時選到宣告同一條 route 的模組）：\n${lines}`)
  }
  return [...owner.keys()]
}
