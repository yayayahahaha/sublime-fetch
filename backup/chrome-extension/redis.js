import { Cluster } from 'ioredis'
import { loadSettings } from './settings-loader.js'

class StagingRedis {
  #redis
  constructor(redis) {
    this.#redis = redis
  }

  getUserOtp(username, brandName) {
    if (username == null || brandName == null) {
      throw new Error(`[${this.constructor.name}] getUserOtp: username 和 brandName 皆為必填`)
    }

    const key = `OTP_MAIL_LOGIN_NEW_DEVICE_${username}@${brandName}`
    console.log(`🫙 Redis 金鑰: ${key}`)

    return this.#redis
      .get(key)
      .then((value) => ({ ok: true, value, error: null }))
      .catch((error) => ({
        ok: false,
        value: null,
        error,
      }))
  }

  getCaptcha(captchaId) {
    if (captchaId == null) {
      throw new Error(`[${this.constructor.name}] getCaptcha: captchaId 為必填`)
    }

    const key = `USER_CAPTCHA_${captchaId}`
    console.log(`🫙 Redis 金鑰: ${key}`)

    return this.#redis
      .get(key)
      .then((value) => ({ ok: true, value, error: null }))
      .catch((error) => ({
        ok: false,
        value: null,
        error,
      }))
  }
}

export function connectRedis() {
  const settings = loadSettings()
  const redis = new Cluster([{
    host: settings.redis.host,
    port: settings.redis.port
  }])

  redis.on('connect', () => {
    console.log('Redis 叢集連線成功！')
  })

  redis.on('error', (err) => {
    console.error('Redis 叢集錯誤:', err)
  })

  process.on('SIGINT', async () => {
    console.log('\n正在斷開與 Redis 的連線...')
    await redis.quit() // 或 redis.disconnect()
    process.exit(0)
  })

  return new StagingRedis(redis)
}
