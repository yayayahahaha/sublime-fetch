// Mock for /chart/markets/list —— 快速 mock：整包回應是靜態資料，放在 data/chart-markets-list.json。
// 直接把真實 API 的 response 整包貼進那個 json 即可；payload 每次 request 都重讀，改 json 不用重啟。
import { readFileSync } from 'node:fs'

const DATA_URL = new URL('./data/chart-markets-list.json', import.meta.url)

export default function register(app) {
  app.get('/chart/markets/list', (req, res) => {
    let payload
    try {
      payload = JSON.parse(readFileSync(DATA_URL, 'utf8'))
    } catch (error) {
      res.locals._mockLabel = `chart/markets/list (data 讀取失敗: ${error.message})`
      return res.status(500).json({ error: `mock data 讀取失敗: ${error.message}` })
    }
    res.locals._mockLabel = `chart/markets/list (${payload?.data?.length ?? 0} markets)`
    res.json(payload)
  })
}
