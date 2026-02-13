import { authenticator } from 'otplib'

// 你的 Google Authenticator 的 secret code
const secret = 'TBLGEDVCFKTNY7TH' // base32 格式

const token = authenticator.generate(secret)
console.log('Current OTP code:', token) // 例如 123456
