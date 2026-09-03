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

    const suffixed = redisBrandName != null ? `${username}@${redisBrandName}` : username

    // 同一種 OTP 可能存在多種 key 格式 (新舊後端並存), 一次全查
    let keys = []
    switch (type.toUpperCase()) {
      case 'LOGIN':
        keys = [`OTP_MAIL_LOGIN_NEW_DEVICE_${suffixed}`, `spot:otp-mail:LOGIN_NEW_DEVICE_${suffixed}`]
        break

      case 'SIGNUP':
        // 註冊用的 key 沒有 brand 後綴
        keys = [`OTP_MAIL__key_${username}`, `spot:otp-mail:key:${username}`]
        break

      case 'TWO_FA_BIND':
        // spot:otp-mail:BIND_GOOGLE_2FA_xxx 已由實際跑過的 log 驗證過, 是目前唯一確認正確的格式
        keys = [`spot:otp-mail:BIND_GOOGLE_2FA_${suffixed}`, `OTP_MAIL_BIND_GOOGLE_2FA_${suffixed}`]
        break

      case 'TWO_FA_UNBIND':
        // spot:otp-mail:UNBIND_GOOGLE_2FA_xxx 已由實際跑過的 log 驗證過, 是目前唯一確認正確的格式
        keys = [
          `spot:otp-mail:UNBIND_GOOGLE_2FA_${suffixed}`,
          `spot:otp-mail:UNTIE_GOOGLE_2FA_${suffixed}`,
          `OTP_MAIL_UNBIND_GOOGLE_2FA_${suffixed}`,
          `OTP_MAIL_UNTIE_GOOGLE_2FA_${suffixed}`,
        ]
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

  // 在不確定確切 key 名稱時的最後手段: 用 username/email 這些 identifier 在常見的
  // email-OTP prefix 底下做 SCAN (支援 cluster, 會對每個 master node 分別掃)
  async findOtpByScan(identifiers, { prefixes = ['OTP_MAIL', 'spot:otp-mail'] } = {}) {
    const values = [...new Set(identifiers.filter(Boolean))]
    if (values.length === 0) {
      return { ok: false, value: null, error: new Error('缺少可用的 identifier (username/email)') }
    }

    const patterns = prefixes.flatMap((prefix) => values.map((value) => `${prefix}*${value}*`))
    console.log(`🔎 Redis SCAN 候選 pattern:\n${patterns.map((pattern) => `   - ${pattern}`).join('\n')}`)

    let keys
    try {
      keys = await this.#scanForKeys(patterns)
    } catch (error) {
      return { ok: false, value: null, error }
    }

    if (keys.length === 0) {
      return {
        ok: false,
        value: null,
        error: new Error(`SCAN 沒有找到符合的 key (patterns: ${patterns.join(', ')})`),
      }
    }

    try {
      const rawValues = await Promise.all(keys.map((key) => this.#redis.get(key)))
      const hits = keys
        .map((key, index) => ({ key, value: rawValues[index] }))
        .filter((hit) => hit.value != null)

      if (hits.length === 0) {
        return { ok: false, value: null, error: new Error('SCAN 找到 key 但值都是 null (可能已過期)') }
      }

      if (hits.length === 1) {
        console.log(`🫙 SCAN 命中 Redis 金鑰: ${hits[0].key}`)
        return { ok: true, value: hits[0].value, error: null }
      }

      const picked = await select({
        message: `SCAN 找到 ${hits.length} 個可能的 email 驗證碼, 請選擇要使用哪一個:`,
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

  async #scanForKeys(patterns, { count = 500, limit = 500 } = {}) {
    const clusterNodes = typeof this.#redis.nodes === 'function' ? this.#redis.nodes('master') : []
    const nodes = clusterNodes.length > 0 ? clusterNodes : [this.#redis]

    const scanOneNode = async (node, pattern) => {
      const keys = []
      let cursor = '0'
      do {
        const [next, batch] = await node.scan(cursor, 'MATCH', pattern, 'COUNT', count)
        cursor = next
        keys.push(...batch)
        if (keys.length >= limit) break
      } while (cursor !== '0')
      return keys
    }

    const results = await Promise.all(
      patterns.flatMap((pattern) => nodes.map((node) => scanOneNode(node, pattern))),
    )
    return [...new Set(results.flat())]
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
