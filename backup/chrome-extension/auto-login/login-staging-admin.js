import { loadSettings } from './settings-loader.js'
import { cyan, lightBlue, lightCyan, lightGreen, lightRed, red } from '../color.js'
import select from '@inquirer/select'
import { gen2FaCode } from './2fa.js'
import { EncodeDecode, errorConsole } from './t99-utils.js'
import { exec } from 'child_process'

import crypto from 'crypto'

function encryptPassword(username, password, random) {
  username = username.toLowerCase()

  const pw = sha1(password)
  const vp = sha1(`voodoo_people_${username}${pw}`)
  const result = random ? sha1(random + vp) : vp

  return result

  function sha1(value) {
    const shasum = crypto.createHash('sha1')
    shasum.update(value)
    return shasum.digest('hex')
  }
}

async function loginAdmin(adminLoginInfo, { getTokenOnly } = {}) {
  const { error: randomCodeError, ...randomCodeRes } = await getRandomCode(adminLoginInfo)
  if (randomCodeError != null) {
    return void errorConsole('初次 login 取得 random code 失敗!', randomCodeError)
  }

  const randomCode = randomCodeRes.msg

  const { error: firstLoginError, ...firstLoginRes } = await firstLogin(adminLoginInfo, randomCode)
  if (firstLoginError != null) return void errorConsole('初次 login 失敗!', firstLoginError)
  const { msg: firstLoginToken } = firstLoginRes

  const { error: finalError, ...finalRes } = await loginWith2faAndFirstToken(
    firstLoginToken,
    adminLoginInfo.secretCode2Fa
  )
  if (finalError != null) return void errorConsole('最後的 login 失敗!', finalError)

  const token = finalRes.data.adminToken
  console.log(lightGreen(`登入成功! 取得的 token 是 ${token}`))
  console.log(lightGreen(`encode 過後是 ${encodeURIComponent(token)}`))
  console.log(lightGreen(`失敗的直接貼這個吧: document.cookie='admin-token=${encodeURIComponent(token)}'`))

  if (getTokenOnly) {
    console.log(lightBlue('有設定 getTokenOnly 參數, 將直接回傳 token'))
    return token
  }

  // 讀取設定判斷是否使用 extension
  const settings = loadSettings()
  const useExtension = settings.useExtension ?? true

  // 開啟瀏覽器的部分
  console.log()
  console.log(lightCyan('開啟瀏覽器..'))

  const exampleDomain = 'https://www.google.com/'
  const url = 'https://admin.btse.co/login'

  if (useExtension) {
    let encodedCode = EncodeDecode.encode({ token, url, toCookie: true }, 10)
    encodedCode = EncodeDecode.encode(encodedCode, 5)

    console.log('瀏覽器跳轉的 encode: ', cyan(encodedCode))

    exec(`open '${exampleDomain}?_=${encodedCode}'`)
  } else {
    // 手動模式
    const manualScript = `document.cookie='admin-token=${encodeURIComponent(token)}; path=/'; location.reload();`

    console.log()
    console.log(lightCyan('--------------------------------------------------'))
    console.log(lightCyan('請在 Admin 登入頁面的 Console 執行以下指令：'))
    console.log()
    console.log(manualScript)
    console.log()
    console.log(lightCyan('--------------------------------------------------'))

    // 自動複製到剪貼簿 (macOS)
    try {
      const copyProcess = exec('pbcopy')
      copyProcess.stdin.write(manualScript)
      copyProcess.stdin.end()
      console.log(lightGreen('📋 已將指令自動複製到剪貼簿！'))
    } catch (e) {
      console.log(red('無法自動複製到剪貼簿'))
    }

    exec(`open '${url}'`)
  }

  console.log(lightGreen('🌠 成功'))
}

async function loginWith2faAndFirstToken(token, secretCode2Fa) {
  const body = new FormData()
  body.append('token', token)
  body.append('optCode', gen2FaCode(secretCode2Fa, { verbose: false }))

  return fetch('https://admin-api.btse.co/api/public/index/optCodeLogin', {
    method: 'post',
    body,
  })
    .then((res) => res.json())
    .then((res) => (res.success ? res : Promise.reject(res)))
    .catch((error) => ({ error }))
}

async function firstLogin(adminLoginInfo, randomCode) {
  const formData = new FormData()
  formData.append('username', adminLoginInfo.account)
  formData.append('password', encryptPassword(adminLoginInfo.account, adminLoginInfo.password, randomCode))

  return fetch('https://admin-api.btse.co/api/public/index/login', {
    method: 'post',
    body: formData,
  })
    .then((res) => res.json())
    .then((res) => {
      if (!res.success && !/^ADMIN_2FA_LOGIN_TOKEN_[\w-]+/.test(res.msg)) {
        throw new Error(res)
      }
      return res
    })
    .catch((error) => ({ error }))
}

async function getRandomCode(adminLoginInfo) {
  const body = new FormData()
  body.append('adminname', adminLoginInfo.account)

  return fetch('https://admin-api.btse.co/api/public/index/random', {
    method: 'post',
    body,
  })
    .then((res) => res.json())
    .then((res) => (res.success ? res : Promise.reject(res)))
    .catch((error) => ({ error }))
}

function settingCheck() {
  const settings = loadSettings()
  const { adminAccounts } = settings
  if (!Array.isArray(adminAccounts)) {
    console.log(red('settings.json 裡 adminAccounts 需為陣列!'))
    return { status: false, accountList: null }
  }

  const neededKeys = ['account', 'password', 'secretCode2Fa']
  for (let i = 0; i < adminAccounts.length; i++) {
    const accountLoginInfo = adminAccounts[i]

    const valueValid = neededKeys.some((key) => {
      const value = accountLoginInfo?.[key]

      return !value || typeof value !== 'string'
    })

    if (valueValid) {
      console.log(red(`settings.json 裡 adminAccounts 的每個物件的 ${neededKeys.join(', ')} 都不可少也都需為字串`))
      return { status: false, accountList: null }
    }
  }

  return { status: true, accountList: adminAccounts }
}

export async function loginStagingAdmin({ getTokenOnly = false } = {}) {
  const { status, accountList } = settingCheck()
  if (!status) return

  const answer = await select({
    message: '要登入哪個帳號?',
    choices: accountList.map((item) => ({
      name: item.account,
      value: item,
      description: (function () {
        const pw = item.password.replace(/.(.+)./g, (value, $1) => {
          return value.replace($1, new Array(value.length).fill('*').join(''))
        })
        return `密碼: ${pw}`
      })(),
    })),
    loop: false,
  }).catch(() => null)
  if (answer == null) return void console.log(lightRed('使用者取消'))

  return loginAdmin(answer, { getTokenOnly })
}
