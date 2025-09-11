import { Cluster } from 'ioredis'
import jsSha3 from 'js-sha3'
const { sha3_256: Hash } = jsSha3

const redis = new Cluster([{ host: '10.1.34.152', port: 6379 }])

redis.on('connect', () => {
  console.log('Redis cluster connected!')
})

redis.on('error', (err) => {
  console.error('Redis cluster error:', err)
})

function getUser(username = 'flyclmexstaging@lmex') {
  return `OTP_MAIL_LOGIN_NEW_DEVICE_${username}`
}

process.on('SIGINT', async () => {
  console.log('\n斷開與 redis 的連線...')
  await redis.quit() // 或 redis.disconnect()
  process.exit(0)
})

async function main() {
  // await redis.set('myKey', 'Hello from cluster!')
  const key = getUser()
  console.log('key:', key)
  const value = await redis.get(key)
  console.log('Value from Redis:', value)
}

console.log(Hash(Hash('!QAZ1qaz')))

main().catch(console.error)
