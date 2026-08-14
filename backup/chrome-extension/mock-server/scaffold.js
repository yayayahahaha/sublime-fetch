// 「新增 Mock API」互動產生器。把「複製 + 改 JS」正規化成問幾個問題：
//   respond（整包取代）→ 寫進宣告式 <module>.mock.json + 建 response JSON 檔（讀檔即改、免碼）
//   tamper（proxy 後改）→ 吐一支獨立 <name>.js 骨架，modify 留白讓你填
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { input } from '@inquirer/prompts'
import select from '@inquirer/select'
import { green, yellow, red, lightCyan, cyan } from '../color.js'

const MOCKS_DIR = fileURLToPath(new URL('./mocks/', import.meta.url))
const WS_MOCKS_DIR = fileURLToPath(new URL('./ws/mocks/', import.meta.url))
const DECL_EXT = '.mock.json'
const WS_DECL_EXT = '.ws.json'
const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch']
const NEW_MODULE = Symbol('new-module')

// 列出現有的宣告式模組（.mock.json）名稱
function listDeclModules() {
  try {
    return fs
      .readdirSync(MOCKS_DIR)
      .filter((n) => n.endsWith(DECL_EXT) && !n.startsWith('_'))
      .map((n) => n.slice(0, -DECL_EXT.length))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  } catch {
    return []
  }
}

function slugFromPath(p) {
  return (
    String(p)
      .replace(/^\/+|\/+$/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'response'
  )
}

function validModuleName(v) {
  const s = String(v ?? '').trim()
  if (!s) return '模組名不能為空'
  if (!/^[a-zA-Z0-9.\-_]+$/.test(s)) return '模組名只能用英數與 . _ -'
  if (s.startsWith('_')) return '模組名不能用 _ 開頭（那是共用檔慣例）'
  return true
}

export async function scaffoldMock() {
  console.log('\n' + lightCyan('=== 新增 Mock API ===') + '\n')

  const mode = await select({
    message: 'mock 模式？',
    choices: [
      { name: 'respond（整包取代；真實 API 完全不會被呼叫）', value: 'respond' },
      { name: 'tamper（proxy 真後端後改回應）', value: 'tamper' },
    ],
    loop: false,
  }).catch(() => null)
  if (mode == null) return void console.log(yellow('取消'))

  const method = await select({
    message: 'HTTP method？',
    choices: HTTP_METHODS.map((m) => ({ name: m.toUpperCase(), value: m })),
    loop: false,
  }).catch(() => null)
  if (method == null) return void console.log(yellow('取消'))

  const rawPath = await input({
    message: 'path（例如 /api/user/account）：',
    validate: (v) => /^\/\S*$/.test(String(v ?? '').trim()) || 'path 需以 / 開頭',
  }).catch(() => null)
  if (rawPath == null) return void console.log(yellow('取消'))
  const routePath = rawPath.trim()

  if (mode === 'respond') return void (await scaffoldRespond({ method, routePath }))
  return void (await scaffoldTamper({ method, routePath }))
}

async function scaffoldRespond({ method, routePath }) {
  const existing = listDeclModules()

  let moduleName = NEW_MODULE
  if (existing.length) {
    const picked = await select({
      message: '加到哪個模組？',
      choices: [
        ...existing.map((n) => ({ name: n, value: n })),
        { name: '＋ 新模組（輸入名稱）', value: NEW_MODULE },
      ],
      loop: false,
    }).catch(() => null)
    if (picked == null) return void console.log(yellow('取消'))
    moduleName = picked
  }
  if (moduleName === NEW_MODULE) {
    const typed = await input({ message: '新模組名稱：', validate: validModuleName }).catch(() => null)
    if (typed == null) return void console.log(yellow('取消'))
    moduleName = typed.trim()
  }

  // 宣告式與手寫不能同名
  if (fs.existsSync(path.join(MOCKS_DIR, `${moduleName}.js`))) {
    return void console.log(red(`已存在手寫模組 ${moduleName}.js，請換個模組名（宣告式與手寫不能同名）`))
  }

  const responseFileRaw = await input({
    message: 'response JSON 檔路徑（相對 mocks/）：',
    default: `data/${moduleName}-${slugFromPath(routePath)}.json`,
    validate: (v) => String(v ?? '').trim().endsWith('.json') || '需為 .json 檔',
  }).catch(() => null)
  if (responseFileRaw == null) return void console.log(yellow('取消'))
  const responseFile = responseFileRaw.trim()

  const specPath = path.join(MOCKS_DIR, `${moduleName}${DECL_EXT}`)
  let spec = { routes: [] }
  if (fs.existsSync(specPath)) {
    try {
      spec = JSON.parse(fs.readFileSync(specPath, 'utf8'))
    } catch (e) {
      return void console.log(red(`讀取現有 ${moduleName}${DECL_EXT} 失敗：${e.message}`))
    }
    if (!Array.isArray(spec.routes)) spec.routes = []
  }

  // 同模組內重複 route 檢查
  if (spec.routes.some((r) => String(r.method).toLowerCase() === method && r.path === routePath)) {
    return void console.log(red(`${moduleName} 裡已經有 ${method.toUpperCase()} ${routePath} 了`))
  }

  spec.routes.push({ method: method.toUpperCase(), path: routePath, mode: 'respond', responseFile })
  fs.writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n', 'utf8')

  // response 檔不存在才建（不覆蓋既有內容）
  const respAbs = path.resolve(MOCKS_DIR, responseFile)
  let created = false
  if (!fs.existsSync(respAbs)) {
    fs.mkdirSync(path.dirname(respAbs), { recursive: true })
    fs.writeFileSync(respAbs, '{}\n', 'utf8')
    created = true
  }

  console.log('\n' + green('✅ 已新增 respond mock'))
  console.log(cyan(`  模組：mocks/${moduleName}${DECL_EXT}`))
  console.log(cyan(`  route：${method.toUpperCase()} ${routePath}`))
  console.log(cyan(`  response：mocks/${responseFile}${created ? ' (已建空檔，去填內容)' : ' (沿用既有檔)'}`))
  console.log(yellow('  啟動 mock server 時把這個模組勾起來即可（預設全選）。\n'))
}

async function scaffoldTamper({ method, routePath }) {
  const typed = await input({
    message: '新模組名稱（會產生 mocks/<名稱>.js）：',
    validate: validModuleName,
  }).catch(() => null)
  if (typed == null) return void console.log(yellow('取消'))
  const moduleName = typed.trim()

  const jsPath = path.join(MOCKS_DIR, `${moduleName}.js`)
  if (fs.existsSync(jsPath)) return void console.log(red(`mocks/${moduleName}.js 已存在，換個名字`))
  if (fs.existsSync(path.join(MOCKS_DIR, `${moduleName}${DECL_EXT}`))) {
    return void console.log(red(`已存在宣告式模組 ${moduleName}${DECL_EXT}，換個名字`))
  }

  fs.writeFileSync(jsPath, tamperTemplate({ moduleName, method, routePath }), 'utf8')

  console.log('\n' + green('✅ 已產生 tamper mock 骨架'))
  console.log(cyan(`  檔案：mocks/${moduleName}.js`))
  console.log(cyan(`  route：${method.toUpperCase()} ${routePath}`))
  console.log(yellow('  打開檔案，在 modify 裡「✏️ 改這裡」的地方改 body（改完存檔 hot reload 生效）。\n'))
}

function tamperTemplate({ moduleName, method, routePath }) {
  return `// ${moduleName} — tamper mock（proxy 真後端後改回應）。由「新增 Mock API」產生。
import { tamper, asJson } from './_helpers.js'

export default function register(app, { defaultApiDomain }) {
  app.${method}('${routePath}', tamper(defaultApiDomain, {
    label: '${moduleName}',
    modify: asJson((body, ctx) => {
      // ✏️ 改這裡：修改 body（真後端回來的回應）後回傳。例如 body.data.foo = 'bar'
      return body // 目前原樣回傳
    }),
  }))
}
`
}

// ─── WS scaffold ──────────────────────────────────────────
// 列出現有的宣告式 WS feed 模組（.ws.json）
function listWsFeedModules() {
  try {
    return fs
      .readdirSync(WS_MOCKS_DIR)
      .filter((n) => n.endsWith(WS_DECL_EXT) && !n.startsWith('_'))
      .map((n) => n.slice(0, -WS_DECL_EXT.length))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  } catch {
    return []
  }
}

const validWsPath = (v) => /^\/\S*$/.test(String(v ?? '').trim()) || 'path 需以 / 開頭（例如 /ws/my-feed）'

export async function scaffoldWsMock() {
  console.log('\n' + lightCyan('=== 新增 Mock WS ===') + '\n')

  const mode = await select({
    message: 'WS 模式？',
    choices: [
      { name: 'feed（自己定時推假資料；真實 ws 不會被呼叫）', value: 'feed' },
      { name: 'tamper（proxy 真 ws 後改下行幀）', value: 'tamper' },
    ],
    loop: false,
  }).catch(() => null)
  if (mode == null) return void console.log(yellow('取消'))

  if (mode === 'feed') return void (await scaffoldWsFeed())
  return void (await scaffoldWsTamper())
}

async function scaffoldWsFeed() {
  const existing = listWsFeedModules()

  let moduleName = NEW_MODULE
  if (existing.length) {
    const picked = await select({
      message: '加到哪個 feed 模組？',
      choices: [
        ...existing.map((n) => ({ name: n, value: n })),
        { name: '＋ 新模組（輸入名稱 + path）', value: NEW_MODULE },
      ],
      loop: false,
    }).catch(() => null)
    if (picked == null) return void console.log(yellow('取消'))
    moduleName = picked
  }

  let specPath
  let spec
  if (moduleName === NEW_MODULE) {
    const typed = await input({ message: '新模組名稱：', validate: validModuleName }).catch(() => null)
    if (typed == null) return void console.log(yellow('取消'))
    moduleName = typed.trim()
    if (fs.existsSync(path.join(WS_MOCKS_DIR, `${moduleName}.js`))) {
      return void console.log(red(`已存在手寫 ws mock ${moduleName}.js，請換個模組名`))
    }
    const p = await input({ message: 'ws path（例如 /ws/my-feed）：', validate: validWsPath }).catch(() => null)
    if (p == null) return void console.log(yellow('取消'))
    spec = { path: p.trim(), mode: 'mock', topics: {} }
    specPath = path.join(WS_MOCKS_DIR, `${moduleName}${WS_DECL_EXT}`)
  } else {
    specPath = path.join(WS_MOCKS_DIR, `${moduleName}${WS_DECL_EXT}`)
    try {
      spec = JSON.parse(fs.readFileSync(specPath, 'utf8'))
    } catch (e) {
      return void console.log(red(`讀取 ${moduleName}${WS_DECL_EXT} 失敗：${e.message}`))
    }
    if (!spec.topics) spec.topics = {}
  }

  const topicRaw = await input({
    message: 'topic 名稱：',
    validate: (v) => String(v ?? '').trim() !== '' || 'topic 不能為空',
  }).catch(() => null)
  if (topicRaw == null) return void console.log(yellow('取消'))
  const topic = topicRaw.trim()
  if (spec.topics[topic]) return void console.log(red(`${moduleName} 已經有 topic「${topic}」了`))

  const intervalRaw = await input({
    message: 'intervalMs（多久推一次）：',
    default: '1000',
    validate: (v) => /^\d+$/.test(String(v ?? '').trim()) || '請輸入正整數',
  }).catch(() => null)
  if (intervalRaw == null) return void console.log(yellow('取消'))

  const payloadRaw = await input({
    message: 'payload JSON 檔路徑（相對 ws/mocks/）：',
    default: `data/${moduleName}-${slugFromPath(topic)}.json`,
    validate: (v) => String(v ?? '').trim().endsWith('.json') || '需為 .json 檔',
  }).catch(() => null)
  if (payloadRaw == null) return void console.log(yellow('取消'))
  const payloadFile = payloadRaw.trim()

  spec.topics[topic] = { intervalMs: Number(intervalRaw.trim()), payloadFile }
  fs.writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n', 'utf8')

  const pfAbs = path.resolve(WS_MOCKS_DIR, payloadFile)
  let created = false
  if (!fs.existsSync(pfAbs)) {
    fs.mkdirSync(path.dirname(pfAbs), { recursive: true })
    fs.writeFileSync(pfAbs, JSON.stringify({ topic, data: {} }, null, 2) + '\n', 'utf8')
    created = true
  }

  console.log('\n' + green('✅ 已新增 WS feed'))
  console.log(cyan(`  模組：ws/mocks/${moduleName}${WS_DECL_EXT}  (path: ${spec.path})`))
  console.log(cyan(`  topic：${topic}  每 ${intervalRaw.trim()}ms 推一次`))
  console.log(cyan(`  payload：ws/mocks/${payloadFile}${created ? ' (已建範本，去填內容)' : ' (沿用既有檔)'}`))
  console.log(yellow('  啟動時把這個 WS mock 勾起來即可（預設全選）。\n'))
}

async function scaffoldWsTamper() {
  const typed = await input({
    message: '新模組名稱（會產生 ws/mocks/<名稱>.js）：',
    validate: validModuleName,
  }).catch(() => null)
  if (typed == null) return void console.log(yellow('取消'))
  const moduleName = typed.trim()

  const jsPath = path.join(WS_MOCKS_DIR, `${moduleName}.js`)
  if (fs.existsSync(jsPath)) return void console.log(red(`ws/mocks/${moduleName}.js 已存在，換個名字`))
  if (fs.existsSync(path.join(WS_MOCKS_DIR, `${moduleName}${WS_DECL_EXT}`))) {
    return void console.log(red(`已存在宣告式 ${moduleName}${WS_DECL_EXT}，換個名字`))
  }

  const p = await input({ message: 'ws path（例如 /ws/my-tamper）：', validate: validWsPath }).catch(() => null)
  if (p == null) return void console.log(yellow('取消'))
  const wsPath = p.trim()

  fs.writeFileSync(jsPath, wsTamperTemplate({ moduleName, wsPath }), 'utf8')

  console.log('\n' + green('✅ 已產生 WS tamper 骨架'))
  console.log(cyan(`  檔案：ws/mocks/${moduleName}.js  (path: ${wsPath})`))
  console.log(yellow('  打開檔案，在 onUpstreamMessage 裡「✏️ 改這裡」改真後端推來的幀（改完存檔 hot reload 生效）。\n'))
}

function wsTamperTemplate({ moduleName, wsPath }) {
  return `// ${moduleName} — WS tamper mock（proxy 真 ws 後改下行幀）。由「新增 Mock WS」產生。
// upstream 預設用啟動時輸入的 ws-domain；要固定連別的 domain 就加 upstreamDomain。
export default {
  path: '${wsPath}',
  mode: 'tamper',
  onUpstreamMessage(raw, ctx) {
    // ✏️ 改這裡：raw 是真後端推來的幀（字串）。改完回傳；回傳 null = 吞掉這一幀。
    return raw // 目前原樣轉發
  },
  // onClientMessage(raw, ctx) { return raw }, // 上行（前端 → 真後端），需要攔改再打開
}
`
}
