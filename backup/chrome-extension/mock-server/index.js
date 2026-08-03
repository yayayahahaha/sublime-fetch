import { input, confirm } from '@inquirer/prompts'
import select from '@inquirer/select'
import { lightGreen, red } from '../color.js'
import { startServer } from './server.js'
import { readDomainHistory, saveDomainHistory } from './domain-history.js'

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

  try {
    defaultApiDomain = await promptDefaultApiDomain()

    showBypass = await confirm({
      message: '是否顯示 proxy 的 log? (mock hit 一律會印)',
      default: false,
    })

    wsDomain = await promptWsDomain()
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
