import { authenticator } from 'otplib'

export function gen2FaCode(secretCode2Fa) {
  console.log(`gen2FaCode: 收到的參數: ${secretCode2Fa}, 生成的參數: ${authenticator.generate(secretCode2Fa)}`)
  return authenticator.generate(secretCode2Fa) ?? null
}
