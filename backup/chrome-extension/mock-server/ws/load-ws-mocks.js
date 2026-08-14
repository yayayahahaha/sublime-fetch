// 動態載入 ws/mocks/ 底下的 WS mock。兩種型態：
//   - 手寫 <name>.js       → export default 一個 WS mock 物件 { path, mode, handle / onUpstreamMessage ... }
//   - 宣告式 <name>.ws.json → { path, mode:'mock', topics:{...} }，由 buildDeclarativeFeed 轉成 feed
// 模組名 = 檔名去副檔名。新增 = 在 ws/mocks/ 丟一個檔即可（不用回 router.js 補 import）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDeclarativeFeed } from './feed-mock.js'

const WS_MOCKS_DIR = fileURLToPath(new URL('./mocks/', import.meta.url))
const DECL_EXT = '.ws.json'

// 掃 ws/mocks/：*.js（跳過 _ 開頭）與 *.ws.json 都算，回傳排序後、去重的名稱。
export function listWsMockNames() {
  let entries
  try {
    entries = fs.readdirSync(WS_MOCKS_DIR, { withFileTypes: true })
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

// 載入指定的 WS mock，回傳 mock 物件陣列（給 attachWsRouter 用）。
// .js → import default 物件；.ws.json → 讀 spec 建 feed。壞掉 / 找不到 / 同名衝突就 throw。
export async function loadWsMocks(names) {
  const mocks = []
  for (const name of names) {
    const jsPath = path.join(WS_MOCKS_DIR, `${name}.js`)
    const jsonPath = path.join(WS_MOCKS_DIR, `${name}${DECL_EXT}`)
    const hasJs = fs.existsSync(jsPath)
    const hasJson = fs.existsSync(jsonPath)

    if (hasJs && hasJson) {
      throw new Error(`ws mock 模組名衝突：同時有 ${name}.js 和 ${name}${DECL_EXT}，請刪掉其一`)
    }

    if (hasJson) {
      let spec
      try {
        spec = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
      } catch (err) {
        throw new Error(`宣告式 ws feed ${name}${DECL_EXT} JSON 解析失敗：${err.message}`)
      }
      mocks.push(buildDeclarativeFeed(spec, { dir: WS_MOCKS_DIR }))
    } else if (hasJs) {
      const url = new URL(`./mocks/${name}.js`, import.meta.url)
      let mod
      try {
        mod = await import(url.href)
      } catch (err) {
        throw new Error(`ws mock 載入失敗 (${name}.js): ${err.message}`)
      }
      if (!mod.default || typeof mod.default !== 'object') {
        throw new Error(`ws mock ${name}.js 的 export default 必須是 WS mock 物件（{ path, mode, ... }）`)
      }
      mocks.push(mod.default)
    } else {
      throw new Error(`找不到 ws mock：${name}（ws/mocks/ 下沒有 ${name}.js 或 ${name}${DECL_EXT}）`)
    }
  }
  return mocks
}
