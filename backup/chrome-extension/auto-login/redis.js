import { Cluster } from 'ioredis'
import { loadSettings } from './settings-loader.js'
import { green } from '../color.js'
import { errorConsole } from './t99-utils.js'

class StagingRedis {
  #redis
  constructor(redis) {
    this.#redis = redis
  }

  disconnect() {
    this.#redis.quit()
    this.#redis.disconnect()
    console.log(green('已中斷 redis 連線'))
  }

  getOtp(username, { brandName = null, type = 'LOGIN' } = {}) {
    if (username == null) {
      throw new Error(`[${this.constructor.name}] getOtp: username 為必填`)
    }

    let redisBrandName = brandName
    switch (brandName) {
      case 'btse':
        redisBrandName = null // btse 沒有後綴
        break

      case 'autotrader':
        redisBrandName = 'copywise' // 改過名字所以會要額外調整
        break
    }

    let key = ''
    let keyPrefix = ''
    switch (type.toUpperCase()) {
      case 'LOGIN':
        keyPrefix = 'OTP_MAIL_LOGIN_NEW_DEVICE_'
        key = redisBrandName != null ? `${keyPrefix}${username}@${redisBrandName}` : `${keyPrefix}${username}`
        break
      case 'SIGNUP':
        keyPrefix = 'OTP_MAIL__key_' // 註冊用的前綴
        key = `${keyPrefix}${username}`
        break
      default:
        // 直接拋出錯誤而不是返回一個 promise a catch
        throw new Error(`不支援的 OTP 類型: ${type}`)
    }

    console.log(`🫙 Redis 金鑰: ${key}`)

    return this.#redis.get(key).then((value) => {
      if (value == null) {
        throw new Error('在 Redis 中找不到 OTP，可能已過期或從未發送。')
      }
      return { ok: true, value, error: null }
    })
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
  const redis = new Cluster([
    {
      host: settings.redis.host,
      port: settings.redis.port,
    },
  ])

  redis.on('connect', () => {
    console.log(green('Redis 叢集連線成功'))
  })

  redis.on('error', (err) => {
    console.error(errorConsole('Redis 叢集錯誤:', err))
  })

  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    console.log('在 AWS Lambda 環境中運行，無法處理 SIGINT 信號。')
    // 在 AWS Lambda 環境中，無法處理 SIGINT 信號，因此不需要斷開連線
  } else {
    process.on('SIGINT', async () => {
      console.log('\n正在斷開與 Redis 的連線...')
      await redis.quit() // 或 redis.disconnect()
      process.exit(0)
    })
  }

  return new StagingRedis(redis)
}
