// Mock for /api/init/wallet。
// 大 payload 放 data/init-wallet.json — 直接把真實 API 的 response 整包貼進去即可。
// payload 每次 request 都重讀，改 json 檔不用重啟 server。
import { readFileSync } from 'node:fs'

const DATA_URL = new URL('./data/init-wallet.json', import.meta.url)

export default function register(app) {
  app.get('/api/init/wallet', (req, res) => {
    let payload
    try {
      payload = JSON.parse(readFileSync(DATA_URL, 'utf8'))
    } catch (error) {
      res.locals._mockLabel = `init-wallet (data/init-wallet.json 讀取失敗: ${error.message})`
      return res.status(500).json({ error: `mock data 讀取失敗: ${error.message}` })
    }
    res.locals._mockLabel = 'init-wallet'
    res.json(payload)
  })
}
