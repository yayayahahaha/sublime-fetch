import indexHtmlContent from './index-html-content.js'

function affiliateProgramRouteFn(req, res) {
  return void res.send('affiliateProgramRouteFn')
}

function streamingQuotesWithParamsRouteFn(req, res) {
  return void res.send('streamingQuotesWithParamsRouteFn')
}

function streamingQuotesRouteFn(req, res) {
  return void res.send('streamingQuotesRouteFn')
}

function copyWiseIndexRouteFn(req, res) {
  return void res.send('copyWiseIndexRouteFn')
}

function lotteryRouteFn(req, res) {
  return void res.send('lotteryRouteFn')
}

function lotteryEventRouteFn(req, res) {
  return void res.send('lotteryEventRouteFn')
}

function affiliateApplyFormRouteFn(req, res) {
  return void res.send('affiliateApplyFormRouteFn')
}

function futuresmktRouteFn(req, res) {
  return void res.send('futuresmktRouteFn')
}

function futuresRouteFn(req, res) {
  return void res.send('futuresRouteFn')
}

function tradingRouteFn(req, res) {
  return void res.send('tradingRouteFn')
}

function eventLandingPageRouteFn(req, res) {
  return void res.send('eventLandingPageRouteFn')
}

function marketsRouteFn(req, res) {
  return void res.send('marketsRouteFn')
}

const routesInfo = [
  {
    name: 'affiliateProgram',
    pattern: '/:lang?/affiliate-program',
    callback: affiliateProgramRouteFn
  },

  {
    name: 'streamingQuotesWithParams',
    pattern: '/:lang?/streaming/:id1/:id2?',
    callback: streamingQuotesWithParamsRouteFn
  },

  {
    name: 'streamingQuotes',
    pattern: '/:lang?/streaming',
    callback: streamingQuotesRouteFn
  },

  {
    name: 'copyWiseIndex',
    pattern: '/:lang?/copywise',
    callback: copyWiseIndexRouteFn
  },

  { name: 'lottery', pattern: '/:lang?/lottery', callback: lotteryRouteFn },

  {
    name: 'lotteryEvent',
    pattern: '/:lang?/lottery/:id',
    callback: lotteryEventRouteFn
  },

  {
    name: 'affiliateApplyForm',
    pattern: '/:lang?/affiliate/apply-form',
    callback: affiliateApplyFormRouteFn
  },

  {
    name: 'futuresmkt',
    pattern: '/:lang?/futuresmkt/:id',
    callback: futuresmktRouteFn
  },

  { name: 'futures', pattern: '/:lang?/futures/:id', callback: futuresRouteFn },

  { name: 'trading', pattern: '/:lang?/trading/:id', callback: tradingRouteFn },

  {
    name: 'eventLandingPage',
    pattern: '/:lang?/events/:eventId',
    callback: eventLandingPageRouteFn
  },

  {
    name: 'markets',
    pattern: '/:lang?/markets/:symbol',
    callback: marketsRouteFn
  }
]

export function generateRouteList(app = null) {
  if (app === null) {
    return { ok: false, errorMessage: 'params "app" is requried!' }
  }

  routesInfo.forEach(route => app.get(route.pattern, route.callback))
  return { ok: true, errorMessage: null }
}
