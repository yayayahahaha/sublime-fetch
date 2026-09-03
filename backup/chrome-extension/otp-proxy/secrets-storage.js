import { loadSettings } from '../auto-login/settings-loader.js'

export function loadLoginProfiles() {
  return loadSettings()?.loginProfiles ?? []
}

export function getSecret(loginProfiles, user, brand) {
  // username 是後來才補上的欄位, 舊 profile 可能還沒有, fallback 比對 email 維持相容
  const profile = loginProfiles.find(
    (p) => p.brandName === brand && (p.username === user || p.email === user),
  )
  return profile?.secretCode2Fa || null
}
