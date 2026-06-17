import { input, confirm } from '@inquirer/prompts'
import { lightGreen, red } from '../color.js'
import { startServer } from './server.js'

export async function mockServer() {
  let defaultApiDomain
  let showBypass

  try {
    defaultApiDomain = await input({
      message: '請輸入 default-api-domain (沒被 mock 的 request 會 proxy 到這):',
      validate(value) {
        const v = (value || '').trim()
        if (!v) return 'default-api-domain 不能為空'
        if (!/^https?:\/\/\S+/.test(v)) return '需要以 http:// 或 https:// 開頭，後面要有 host'
        return true
      },
    })

    showBypass = await confirm({
      message: '是否顯示 proxy 的 log? (mock hit 一律會印)',
      default: false,
    })
  } catch (e) {
    if (e?.name === 'ExitPromptError') return
    console.error(red(`prompt error: ${e.message}`))
    return
  }

  console.log()
  console.log(lightGreen('啟動 Mock Server...'))
  console.log()

  try {
    await startServer({
      defaultApiDomain: defaultApiDomain.trim(),
      showBypass,
    })
  } catch (e) {
    console.error(red(`啟動失敗: ${e.message}`))
  }
}
