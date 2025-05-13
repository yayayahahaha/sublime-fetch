import { authenticator } from 'otplib'
import { loadSettings } from './settings-loader.js'

export function gen2FaCode(userPk) {
  const settings = loadSettings()
  const user = settings.users.find(u => u.pk === userPk)
  return user ? authenticator.generate(user.secretCode2Fa) : null
}
