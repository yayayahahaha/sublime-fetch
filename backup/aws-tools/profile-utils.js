import fs from 'fs'
import path from 'path'
import { PROJECT_ROOT } from './utils.js'

// export const profile = 'staging'
export const profile = 'app-btse'
// export const profile = ''

export function getProfileOptions() {
  const configContent = fs.readFileSync(`/Users/flyc.chung/.aws/config`, 'utf8')
  return configContent
    .split('\n')
    .filter(item => !!String(item).trim())
    .map(profileSetting => profileSetting.match(/([^\s]+)\]/)[1])
    .map(profile => ({ name: profile, value: profile }))
}

export function setProfile(profile) {
  const data = { profile }
  fs.writeFileSync(
    path.resolve(PROJECT_ROOT, 'payload.json'),
    JSON.stringify(data),
    'utf8'
  )
}

export function getProfile() {
  const content = fs.readFileSync(
    path.resolve(PROJECT_ROOT, 'payload.json'),
    'utf8'
  )

  try {
    return JSON.parse(content)?.profile ?? null
  } catch (e) {
    console.log(e)
    return null
  }
}
