import express from 'express'
import serverless from 'serverless-http'
import { isHuman, variables } from './utils.js'
import indexHtmlContent from './index-html-content.js' // 會由 build-lambda-server-environment.js 產生
import { generateRouteList } from './routes-utils.js'

import { i18n } from './i18n-setup.js'

const app = express()

// middleware，檢查是否是人類，是的話直接 send index.html
app.use((req, res, next) => {
  if (isHuman(req, false)) return void res.send(indexHtmlContent)

  return void next()
})

// middleware: 產出 title 和 description
app.use((req, res, next) => {
  if (isHuman(req, false)) return void res.send(indexHtmlContent)

  return void next()
})

// 產出所有需要 SEO 的路由
generateRouteList(app)

// 其他不需要 SEO 的路由
app.get('*', async (req, res) => {
  if (!console /* TODO(flyc): testing codes */) {
    return (() => {
      const { i18nFn } = variables
      const { titleMetaGenerator } = i18nFn

      const $route = { name: 'home', meta: {} }

      i18n.global.locale.value = 'zh_TW'

      const title = titleMetaGenerator({ i18n, $route })
      return void res.send(title)
    })()
  }

  return void res.send(indexHtmlContent)
})

export const handler = serverless(app)

// TODO
// 無法取得 query-string, 可能是 apigateway 的設定問題? https://repost.aws/knowledge-center/pass-api-gateway-rest-api-parameters

// reference
// https://gist.github.com/RakaDoank/05da35887051a8f999aabc23d30194e3
// https://www.serverless.com/framework/docs/getting-started
