import { confirm } from '@inquirer/prompts'
import { green, lightCyan, lightGreen, lightRed, yellow } from '../color.js'
import { loadSettings, saveSettings } from './settings-loader.js'
import { AdminApiError, getAssignedRoles, stageLog, toAdminRoleWhitelabel } from '../admin-related/admin-api.js'
import { ensureAndSwitchToBrandRole } from '../admin-related/deposit.js'
import { getAdminTokenWithCache, selectAdminAccount } from '../admin-related/admin-token-cache.js'
import { searchUsersByEmail } from '../admin-related/reset-user-otp-limit.js'

// 純粹拿來給使用者參考: settings.json 裡的 email 欄位本來就有些其實存的是 username (login 兩種都吃),
// 這支 script 完全不會去動既有的 email 欄位 (它是 LoginNeeded 登入用的欄位, 動了有風險), 只補 username
function looksLikeEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function profileLabel(profile) {
  return profile.displayName ?? profile.email ?? '(未命名 profile)'
}

export async function runBackfillProfileIdentifiersCli() {
  const settings = loadSettings()
  const profiles = settings.loginProfiles ?? []
  if (profiles.length === 0) {
    console.log(lightRed('settings.json 裡沒有任何 loginProfiles'))
    return
  }

  const needsUsername = profiles.filter((p) => !p.username || String(p.username).trim() === '')
  if (needsUsername.length === 0) {
    console.log(green('👌 所有 profile 都已經有 username, 不用補'))
    return
  }

  console.log()
  console.log(lightCyan(`共 ${needsUsername.length} 個 profile 缺少 username, 準備透過後台 userList 查詢補齊:`))
  needsUsername.forEach((p) => {
    const hint = looksLikeEmail(p.email)
      ? ''
      : yellow(' (email 欄位看起來像是 username, 不是真的 email, 查詢可能查不到)')
    console.log(`  - ${profileLabel(p)} (brand=${p.brandName}, email=${p.email})${hint}`)
  })

  const adminEntry = await selectAdminAccount()
  if (!adminEntry) return console.log(yellow('使用者取消'))

  let token
  try {
    ;({ token } = await getAdminTokenWithCache(adminEntry))
  } catch (e) {
    return console.log(lightRed(`登入失敗: ${e?.message ?? e}`))
  }
  const adminname = adminEntry.account
  console.log(lightCyan(`👤 當前 admin: ${adminname}`))

  // 依 brand 分組, 一個 brand 只切一次 role, 不用每個 profile 都切
  const byBrand = new Map()
  for (const p of needsUsername) {
    const list = byBrand.get(p.brandName) ?? []
    list.push(p)
    byBrand.set(p.brandName, list)
  }

  const results = [] // { profile, status: 'FILLED' | 'NOT_FOUND' | 'AMBIGUOUS' | 'ERROR', username?, note?, candidates? }

  for (const [brandName, brandProfiles] of byBrand) {
    console.log()
    console.log(lightCyan(`=== brand: ${brandName} (${brandProfiles.length} 個 profile) ===`))

    try {
      const assigned = await getAssignedRoles(token)
      const hasBrandRole = assigned.some((r) => r.platform === toAdminRoleWhitelabel(brandName))
      let allowAutoAddRole = false
      if (!hasBrandRole) {
        console.log(yellow(`⚠ 當前 admin (${adminname}) 沒有 brand "${brandName}" 的 role`))
        allowAutoAddRole = await confirm({
          message: `要自動幫你新增 ${brandName} 的 role 嗎? (寫權限動作, 會持續存在)`,
          default: false,
        }).catch(() => false)
        if (!allowAutoAddRole) {
          brandProfiles.forEach((p) =>
            results.push({ profile: p, status: 'ERROR', note: `跳過: 沒有 brand "${brandName}" 的 role` }),
          )
          continue
        }
      }
      await ensureAndSwitchToBrandRole({ token, adminname, brandName, allowAutoAddRole })
    } catch (e) {
      const note = e instanceof AdminApiError ? e.message : `切 role 失敗: ${e?.message ?? e}`
      brandProfiles.forEach((p) => results.push({ profile: p, status: 'ERROR', note }))
      continue
    }

    for (const profile of brandProfiles) {
      try {
        stageLog(`查 user (email="${profile.email}")`)
        const candidates = await searchUsersByEmail(token, profile.email)

        if (candidates.length === 0) {
          console.log(yellow('  ⚠ 查不到任何符合的 user'))
          results.push({ profile, status: 'NOT_FOUND' })
          continue
        }
        if (candidates.length > 1) {
          console.log(yellow(`  ⚠ 查到 ${candidates.length} 筆, 無法自動判斷, 跳過`))
          results.push({ profile, status: 'AMBIGUOUS', candidates })
          continue
        }

        const [found] = candidates
        console.log(green(`  ✓ 找到: username=${found.username} (uid=${found.uid})`))
        results.push({ profile, status: 'FILLED', username: found.username })
      } catch (e) {
        const note = e instanceof AdminApiError ? e.message : (e?.message ?? String(e))
        console.log(lightRed(`  ✗ 查詢失敗: ${note}`))
        results.push({ profile, status: 'ERROR', note })
      }
    }
  }

  console.log()
  console.log(lightCyan('---------------- 總結 ----------------'))
  const filled = results.filter((r) => r.status === 'FILLED')
  const notFound = results.filter((r) => r.status === 'NOT_FOUND')
  const ambiguous = results.filter((r) => r.status === 'AMBIGUOUS')
  const errored = results.filter((r) => r.status === 'ERROR')

  filled.forEach((r) => console.log(lightGreen(`✓ ${profileLabel(r.profile)}: username = ${r.username}`)))
  notFound.forEach((r) =>
    console.log(yellow(`⚠ ${profileLabel(r.profile)}: userList 查不到, 跳過 (email 欄位可能不是真的 email)`)),
  )
  ambiguous.forEach((r) =>
    console.log(yellow(`⚠ ${profileLabel(r.profile)}: 查到 ${r.candidates.length} 筆, 跳過, 需要手動確認`)),
  )
  errored.forEach((r) => console.log(lightRed(`✗ ${profileLabel(r.profile)}: ${r.note}`)))

  if (filled.length === 0) {
    console.log()
    console.log(yellow('沒有任何 profile 可以自動補齊 username'))
    return
  }

  console.log()
  const isConfirm = await confirm({
    message: `確定要把上面 ${filled.length} 筆 username 寫回 settings.json 嗎?`,
    default: false,
  }).catch(() => false)
  if (!isConfirm) return console.log(yellow('已取消, 沒有寫入 settings.json'))

  for (const r of filled) {
    r.profile.username = r.username
  }
  settings.loginProfiles = profiles
  saveSettings(settings)
  console.log(lightGreen(`✅ 已把 ${filled.length} 筆 username 寫回 settings.json`))
}
