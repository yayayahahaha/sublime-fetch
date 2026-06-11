// nodejs environment
import fetch from 'node-fetch'
const URL =
  'https://www.autotrader.io/en/autotrader?strategyId=e2e64998-89e2-43e7-82a7-9864e3e18e63&refCode=mjZxJJJ9&symbol=PEPE'

const btseUrl =
  'https://www.btse.com/en/autotrader?strategyId=f6f2c8b9-0d50-4673-a35c-3a5e6813b3ee&refCode=006dbSMQ&symbol=ARB'

function start() {
  // fetch(URL, {
  fetch(btseUrl, {
    // 將這個 User-Agent header 移除，就可以看到沒有 prerender 的版本
    headers: { 'User-Agent': 'Googlebot/2.1' }
  })
    .then(r => r.text())
    .then(console.log)
}
start()
