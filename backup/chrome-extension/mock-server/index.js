import { input, confirm } from '@inquirer/prompts'
import select from '@inquirer/select'
import { lightGreen, red } from '../color.js'
import { startServer } from './server.js'
import { readDomainHistory, saveDomainHistory } from './domain-history.js'

const NEW_DOMAIN = Symbol('new-domain')

function validateDomain(value) {
  const v = (value || '').trim()
  if (!v) return 'default-api-domain 不能為空'
  if (!/^https?:\/\/\S+/.test(v)) return '需要以 http:// 或 https:// 開頭，後面要有 host'
  return true
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

export async function mockServer() {
  let defaultApiDomain
  let showBypass

  try {
    defaultApiDomain = await promptDefaultApiDomain()

    showBypass = await confirm({
      message: '是否顯示 proxy 的 log? (mock hit 一律會印)',
      default: false,
    })
  } catch (e) {
    if (e?.name === 'ExitPromptError') return
    console.error(red(`prompt error: ${e.message}`))
    return
  }

  const domain = defaultApiDomain.trim()
  saveDomainHistory(domain)

  console.log()
  console.log(lightGreen('啟動 Mock Server...'))
  console.log()

  try {
    await startServer({
      defaultApiDomain: domain,
      showBypass,
    })
  } catch (e) {
    console.error(red(`啟動失敗: ${e.message}`))
  }
}
