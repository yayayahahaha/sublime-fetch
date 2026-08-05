import { fork } from 'node:child_process'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { input, confirm } from '@inquirer/prompts'
import select from '@inquirer/select'
import { lightGreen, red, yellow, cyan } from '../color.js'
import { startServer } from './server.js'
import { readDomainHistory, saveDomainHistory } from './domain-history.js'

const RESTART_DEBOUNCE_MS = 150

const NEW_DOMAIN = Symbol('new-domain')
const NO_WS = Symbol('no-ws')

function validateDomain(value) {
  const v = (value || '').trim()
  if (!v) return 'default-api-domain 不能為空'
  if (!/^https?:\/\/\S+/.test(v)) return '需要以 http:// 或 https:// 開頭，後面要有 host'
  return true
}

function validateWsDomain(value) {
  const v = (value || '').trim()
  if (!v) return 'ws-domain 不能為空'
  if (!/^(wss?|https?):\/\/\S+/.test(v)) return '需要以 ws(s):// 或 http(s):// 開頭，後面要有 host'
  return true
}

// 網址列複製常常是 http(s)://，自動換成 ws(s)://
function normalizeWsDomain(domain) {
  return domain.trim().replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://')
}

async function promptDefaultApiDomain() {
  const history = readDomainHistory()

  if (history.length > 0) {
    const picked = await select({
      message: '請選擇 default-api-domain (沒被 mock 的 request 會 proxy 到這):',
      choices: [
        ...history.map((domain) => ({ name: domain, value: domain })),
        { name: '✏️  輸入新的 domain', value: NEW_DOMAIN },
      ],
      loop: false,
    })
    if (picked !== NEW_DOMAIN) return picked
  }

  return input({
    message: '請輸入 default-api-domain (沒被 mock 的 request 會 proxy 到這):',
    validate: validateDomain,
  })
}

// 回傳正規化後的 ws domain，或 null (不啟用 WS 轉發)
async function promptWsDomain() {
  const history = readDomainHistory('ws')

  const picked = await select({
    message: '請選擇 ws-domain (tamper 與沒被 mock 的 ws upgrade 會轉發到這):',
    choices: [
      { name: '🚫 不啟用 WS 轉發 (純 mock 的 ws 仍可用)', value: NO_WS },
      ...history.map((domain) => ({ name: domain, value: domain })),
      { name: '✏️  輸入新的 domain', value: NEW_DOMAIN },
    ],
    loop: false,
  })
  if (picked === NO_WS) return null
  if (picked !== NEW_DOMAIN) return picked

  const typed = await input({
    message: '請輸入 ws-domain (輸入 http(s):// 會自動轉成 ws(s)://):',
    validate: validateWsDomain,
  })
  return normalizeWsDomain(typed)
}

export async function mockServer() {
  let defaultApiDomain
  let showBypass
  let wsDomain
  let hotReload

  try {
    defaultApiDomain = await promptDefaultApiDomain()

    showBypass = await confirm({
      message: '是否顯示 proxy 的 log? (mock hit 一律會印)',
      default: false,
    })

    wsDomain = await promptWsDomain()

    hotReload = await confirm({
      message: '要啟用 hot reload 嗎? (改動 mock-server 檔案會自動重啟 server)',
      default: true,
    })
  } catch (e) {
    if (e?.name === 'ExitPromptError') return
    console.error(red(`prompt error: ${e.message}`))
    return
  }

  const domain = defaultApiDomain.trim()
  saveDomainHistory(domain)
  if (wsDomain != null) saveDomainHistory(wsDomain, 'ws')

  console.log()
  console.log(lightGreen('啟動 Mock Server...'))
  console.log()

  if (hotReload) {
    runWithHotReload({ defaultApiDomain: domain, showBypass, wsDomain })
    return
  }

  try {
    await startServer({
      defaultApiDomain: domain,
      showBypass,
      wsDomain,
    })
  } catch (e) {
    console.error(red(`啟動失敗: ${e.message}`))
  }
}

// 讓 server 跑在 child process，監看 mock-server 目錄，一有變動就 kill 掉重 fork。
// ESM 的 module 一旦載入就 cache 住，唯一保證任何改動都生效的做法就是全新 process。
function runWithHotReload({ defaultApiDomain, showBypass, wsDomain }) {
  const runPath = fileURLToPath(new URL('./run.js', import.meta.url))
  const watchDir = fileURLToPath(new URL('.', import.meta.url)) // mock-server/ 目錄本身

  const childEnv = {
    ...process.env,
    MOCK_DEFAULT_API_DOMAIN: defaultApiDomain,
    MOCK_SHOW_BYPASS: showBypass ? '1' : '0',
    MOCK_WS_DOMAIN: wsDomain ?? '',
  }

  let child = null
  let restarting = false // 「是我們主動 kill、要接著重開」的旗標

  const spawnChild = () => {
    child = fork(runPath, { env: childEnv, stdio: 'inherit' })
    child.on('exit', () => {
      const wasRestarting = restarting
      restarting = false
      child = null
      // 只有「主動重啟」才自動重開；child 自己 crash (例如 mock 檔寫壞) 就停著，
      // 等下次存檔修好再由 watcher 觸發重開
      if (wasRestarting) spawnChild()
    })
  }

  const restart = () => {
    if (child) {
      restarting = true
      child.kill('SIGTERM') // 等它 exit 事件觸發後才重 fork，避免 port 還沒釋放
    } else {
      spawnChild() // 上一個 child 已經死了 (crash 過)，直接開新的
    }
  }

  spawnChild()

  let debounceTimer = null
  const watcher = fs.watch(watchDir, { recursive: true }, (_eventType, filename) => {
    if (!filename) return
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      console.log('\n' + yellow(`🔄 偵測到變動 (${filename})，重啟 mock server…`) + '\n')
      restart()
    }, RESTART_DEBOUNCE_MS)
  })

  console.log(cyan('🔥 hot reload 已啟用：改動 mock-server 檔案會自動重啟 (Ctrl+C 結束)\n'))

  // Ctrl+C：收掉 watcher 和 child 再退出，避免留下佔 port 的孤兒 process
  process.on('SIGINT', () => {
    watcher.close()
    if (child) child.kill('SIGTERM')
    process.exit(0)
  })
}
