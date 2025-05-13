import { authenticator } from 'otplib'

// 你的 Google Authenticator 的 secret code
// const secret = 'TBLGEDVCFKTNY7TH' // base32 格式

export function gen2FaCode(secret) {
  return typeof secret === 'string' ? authenticator.generate(secret) : null
}
