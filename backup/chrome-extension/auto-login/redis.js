import { Cluster } from 'ioredis'
import select from '@inquirer/select'
import { loadSettings } from './settings-loader.js'
import { green } from '../color.js'
import { errorConsole } from './t99-utils.js'

class StagingRedis {
  #redis
  #onDisconnect
  constructor(redis, onDisconnect) {
    this.#redis = redis
    this.#onDisconnect = onDisconnect ?? (() => {})
  }

  disconnect() {
    this.#redis.quit()
    this.#redis.disconnect()
    this.#onDisconnect()
    console.log(green('已中斷 redis 連線'))
  }

  async getOtp(username, { brandName = null, type = 'LOGIN' } = {}) {
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

    // 同一種 OTP 可能存在多種 key 格式 (新舊後端並存), 一次全查
    let keys = []
    switch (type.toUpperCase()) {
      case 'LOGIN': {
        const suffixed = redisBrandName != null ? `${username}@${redisBrandName}` : username
        keys = [`OTP_MAIL_LOGIN_NEW_DEVICE_${suffixed}`, `spot:otp-mail:LOGIN_NEW_DEVICE_${suffixed}`]
        break
      }
      case 'SIGNUP':
        // 註冊用的 key 沒有 brand 後綴
        keys = [`OTP_MAIL__key_${username}`, `spot:otp-mail:key:${username}`]
        break
      default:
        // 直接拋出錯誤而不是返回一個 promise a catch
        throw new Error(`不支援的 OTP 類型: ${type}`)
    }

    console.log(`🫙 Redis 金鑰候選:\n${keys.map((key) => `   - ${key}`).join('\n')}`)

    try {
      const values = await Promise.all(keys.map((key) => this.#redis.get(key)))
      const hits = keys
        .map((key, index) => ({ key, value: values[index] }))
        .filter((hit) => hit.value != null)

      if (hits.length === 0) {
        return {
          ok: false,
          value: null,
          error: new Error(
            `在 Redis 中找不到 OTP (嘗試過的 keys: ${keys.join(', ')})。可能原因: (1) OTP 已過期或從未發送 (2) settings.json 的 redis.host 已過時 (例如 staging Redis 換了 IP) — 可用 isolated-operate-redis 連看看實際的 staging Redis 確認。`,
          ),
        }
      }

      if (hits.length === 1) {
        console.log(`🫙 命中 Redis 金鑰: ${hits[0].key}`)
        return { ok: true, value: hits[0].value, error: null }
      }

      const picked = await select({
        message: `找到 ${hits.length} 個 OTP, 請選擇要使用哪一個:`,
        choices: hits.map((hit) => ({ name: `${hit.key}  →  ${hit.value}`, value: hit.value })),
      }).catch(() => null)
      if (picked == null) {
        return { ok: false, value: null, error: new Error('使用者取消選擇 OTP') }
      }
      return { ok: true, value: picked, error: null }
    } catch (error) {
      return { ok: false, value: null, error }
    }
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

// 全域追蹤目前還沒 disconnect 的 redis 連線, SIGINT 時統一斷開
// 用 module-level state 避免每次 connectRedis 都新增 SIGINT listener (那會導致 MaxListenersExceededWarning)
const activeRedisConnections = new Set()
let sigintRegistered = false

function ensureSigintHandlerRegistered() {
  if (sigintRegistered) return
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    console.log('在 AWS Lambda 環境中運行，無法處理 SIGINT 信號。')
    return
  }
  sigintRegistered = true
  process.on('SIGINT', async () => {
    if (activeRedisConnections.size === 0) process.exit(0)
    console.log('\n正在斷開與 Redis 的連線...')
    await Promise.all(
      [...activeRedisConnections].map((r) =>
        Promise.resolve(r.quit()).catch(() => {}),
      ),
    )
    process.exit(0)
  })
}

export function connectRedis() {
  const settings = loadSettings()
  const redis = new Cluster([
    {
      host: settings.redis.host,
      port: settings.redis.port,
    },
  ])

  redis.on('connect', () => console.log(green('Redis 叢集連線成功')))
  redis.on('error', (err) => errorConsole('Redis 叢集錯誤:', err))

  activeRedisConnections.add(redis)
  ensureSigintHandlerRegistered()

  return new StagingRedis(redis, () => activeRedisConnections.delete(redis))
}
