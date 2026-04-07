import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { gen2FaCode, get2FaTimeRemaining } from './2fa.js'
import select, { Separator } from '@inquirer/select'
import { input } from '@inquirer/prompts'
import { blue, lightGreen, lightCyan, red } from '../color.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const filePath = path.resolve(dirname, '2fa-storage.json')

function load2FaStorage() {
  if (!fs.existsSync(filePath)) return []
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    console.log(red('解析 2FA 檔案失敗: '), error.message)
    return []
  }
}

function save2FaStorage(data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
}

export async function twoFaHelper() {
  const mode = await select({
    message: '2FA 助手要做什麼?',
    choices: [
      { name: '讀取 (計算 2FA Code)', value: 'READ' },
      { name: '生成 (儲存新 2FA)', value: 'GENERATE' },
    ],
  }).catch(() => null)

  if (mode === 'READ') return readMode()
  if (mode === 'GENERATE') return generateMode()
}

async function readMode() {
  const storage = load2FaStorage()
  const profiles = storage
    .map(line => {
      try {
        const url = new URL(line)
        const secret = url.searchParams.get('secret')
        const issuer = url.searchParams.get('issuer')
        const label = decodeURIComponent(url.pathname.split(':').pop() || '')
        
        return {
          name: `${issuer || 'Unknown'} (${label || 'No Label'})`,
          value: secret,
        }
      } catch {
        return null
      }
    })
    .filter(Boolean)

  if (profiles.length === 0) {
    console.log(red('檔案中沒有有效的 2FA 資訊'))
    return
  }

  const secret = await select({
    message: '請選擇要計算的 2FA:',
    choices: profiles,
    loop: false,
  }).catch(() => null)

  if (secret) {
    const code = gen2FaCode(secret, { verbose: false })
    const remaining = get2FaTimeRemaining()
    console.log()
    console.log(lightCyan('----------------------------------'))
    console.log(`🔐 2FA Code: `, '\x1b[1m\x1b[43m', code, '\x1b[0m', ` (剩餘約 ${remaining} 秒)`)
    console.log(lightCyan('----------------------------------'))
    console.log()
  }
}

async function generateMode() {
  const profileName = await input({ message: '請輸入 2FA Profile 名字 (例如: Staging-Admin):' })
  const secret = await input({ 
    message: '請輸入 Security Code (Secret):',
    validate: (val) => val.length >= 16 || 'Secret 通常至少 16 位長'
  })
  const label = await input({ message: '請輸入 Label (例如: flycchung):', default: 'user' })

  const otpauth = `otpauth://totp/${profileName}:${label}?secret=${secret.toUpperCase().replace(/\s/g, '')}&issuer=${profileName}`
  
  const storage = load2FaStorage()
  storage.push(otpauth)
  
  try {
    save2FaStorage(storage)
    console.log(lightGreen('✅ 已成功儲存 2FA 資訊到檔案！'))
  } catch (err) {
    console.log(red('儲存失敗: '), err.message)
  }
}
