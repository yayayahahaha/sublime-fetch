// Mock for Futures Trade History 頁面（src/views/order/futures/trade-history/index.vue）。
//
// 為什麼整包 respond 而不是 tamper：這頁的資料是「這個帳號真的下過的合約成交紀錄」，
// 一般測試帳號多半是空的或筆數太少，覆蓋不到 LIQUIDATION / TWAP / FUNDING / 展開明細
// 這些分支，所以直接假造一組覆蓋主要 render 路徑的資料，而不是 proxy 真後端。
//
// 覆蓋到的欄位/路徑對照 src/components/order/futures/TradeHistoryListRow.vue：
//   - fee / feeCurrency badge（fee 欄位是直接印 API 給的 feeCurrency，沒有前端 fallback）
//   - LIQUIDATION + orderDetailType=PARTIAL_LIQUIDATION → 展開明細（futureTradeHistories）
//     + buyOrSell 用子單 tempOrderMode 統計 buy/sell 計數的分支
//   - orderDetailType=TWAP → subtype 那一行
//   - orderType=FUNDING → isFunding 讓 filled size / fee 顯示 '-'
//   - realizedPnl 正負值 → colorSide 紅綠分支
//
// enum 數值對照 src/const.js：ORDER_TYPE.LIMIT=76 / MARKET=77 / LIQUIDATION=1003 / FUNDING=110，
// ORDER_MODE.BUY=66 / SELL=83（是 'B'/'S' 的 charCode，不是隨便給的數字）。
//
// symbol 格式（'BTC-PERP' 等）、walletName 格式（'CROSS' / 'ISOLATED@{symbol}-{quote}'）
// 照 src/utils/futures.js 的註解（getWalletMarketSymbol: 'ISOLATED@BTC-PERP-USDT' -> 'BTC-PERP'）。
//
// futuresTradeHistoryDetail（handleHover 觸發的 net amount / realized pnl 懸浮明細）跟
// futureTradeHistories（展開列的子成交）是兩個完全不同的資料——後者是列表列自帶的陣列，
// 前者是另一支 API、shape 是 { asset, amount, assetPrice, value, fiat }
// （對照 src/components/order/futures/DetailInfoBoardPopup.vue 的 DetailInfo type）。

const envelope = (data) => ({
  code: 1,
  msg: 'Success',
  time: Date.now(),
  data,
  success: true
})

const DAY = 86400000
const daysAgo = (n) => Date.now() - n * DAY

const ORDER_TYPE = { LIMIT: 76, MARKET: 77, LIQUIDATION: 1003, FUNDING: 110 }
const ORDER_MODE = { BUY: 66, SELL: 83 }

// ─── 主列表（pageItems）──────────────────────────────────────
const ROWS = [
  // 一般 LIMIT BUY，全部欄位都正常，用來當 baseline
  {
    orderId: 'MOCKFUT00000001',
    dateTime: daysAgo(0),
    symbol: 'BTC-PERP',
    tempOrderMode: ORDER_MODE.BUY,
    orderType: ORDER_TYPE.LIMIT,
    orderDetailType: '',
    fillPrice: 62350.5,
    fillPriceDecimal: 62350.5,
    orderPrice: 62350.5,
    orderPriceDecimal: 62350.5,
    fillSize: 25,
    orderSize: 25,
    contractSize: 0.001,
    currency: 'BTC',
    feeCurrency: 'USDT',
    fee: 1.558,
    positionRemaining: 25,
    realizedPnl: 0,
    total: -1.558,
    walletName: 'CROSS',
    futureTradeHistories: []
  },
  // MARKET SELL，帳面虧損 → 驗 colorSide 紅字分支；ISOLATED 錢包命名
  {
    orderId: 'MOCKFUT00000002',
    dateTime: daysAgo(1),
    symbol: 'ETH-PERP',
    tempOrderMode: ORDER_MODE.SELL,
    orderType: ORDER_TYPE.MARKET,
    orderDetailType: '',
    fillPrice: 3120.25,
    fillPriceDecimal: 3120.25,
    orderPrice: null,
    orderPriceDecimal: null,
    fillSize: 40,
    orderSize: 40,
    contractSize: 0.01,
    currency: 'ETH',
    feeCurrency: 'USDT',
    fee: 3.744,
    positionRemaining: 0,
    realizedPnl: -12.6,
    total: -16.344,
    walletName: 'ISOLATED@ETH-PERP-USDT',
    futureTradeHistories: []
  },
  // TWAP：orderDetailType=TWAP，orderType 仍是底層 MARKET → 驗 subtype 那一行
  {
    orderId: 'MOCKFUT00000003',
    dateTime: daysAgo(1),
    symbol: 'SOL-PERP',
    tempOrderMode: ORDER_MODE.BUY,
    orderType: ORDER_TYPE.MARKET,
    orderDetailType: 'TWAP',
    fillPrice: 148.32,
    fillPriceDecimal: 148.32,
    orderPrice: 148.32,
    orderPriceDecimal: 148.32,
    fillSize: 100,
    orderSize: 100,
    contractSize: 1,
    currency: 'SOL',
    feeCurrency: 'USDT',
    fee: 1.4832,
    positionRemaining: 100,
    realizedPnl: 0,
    total: -1.4832,
    walletName: 'CROSS',
    futureTradeHistories: []
  },
  // FUNDING：isFunding=true → filled size / fee 欄位在畫面上顯示 '-'
  // （fee/feeCurrency 仍然給值，用來驗證畫面「有值但被規則蓋成 -」而不是「本來就沒有」）
  {
    orderId: 'MOCKFUT00000004',
    dateTime: daysAgo(2),
    symbol: 'BTC-PERP',
    tempOrderMode: ORDER_MODE.SELL,
    orderType: ORDER_TYPE.FUNDING,
    orderDetailType: '',
    fillPrice: 0,
    fillPriceDecimal: 0,
    orderPrice: null,
    orderPriceDecimal: null,
    fillSize: 0,
    orderSize: 0,
    contractSize: 0.001,
    currency: 'BTC',
    feeCurrency: 'USDT',
    fee: 0.42,
    positionRemaining: 25,
    realizedPnl: 0,
    total: -0.42,
    walletName: 'CROSS',
    futureTradeHistories: []
  },
  // LIQUIDATION + PARTIAL_LIQUIDATION：驗 showLiqPriceTooltip、展開列（futureTradeHistories，
  // 子單一買一賣 → buyOrSell 統計後應顯示 '-'），以及 hasChildren 的展開箭頭
  {
    orderId: 'MOCKFUT00000005',
    dateTime: daysAgo(3),
    symbol: 'ETH-PERP',
    tempOrderMode: ORDER_MODE.SELL,
    orderType: ORDER_TYPE.LIQUIDATION,
    orderDetailType: 'PARTIAL_LIQUIDATION',
    fillPrice: 2980.1,
    fillPriceDecimal: 2980.1,
    orderPrice: 2980.1,
    orderPriceDecimal: 2980.1,
    fillSize: 60,
    orderSize: 60,
    contractSize: 0.01,
    currency: 'ETH',
    feeCurrency: 'USDT',
    fee: 5.364,
    positionRemaining: 0,
    realizedPnl: -84.2,
    total: -89.564,
    walletName: 'ISOLATED@ETH-PERP-USDT',
    futureTradeHistories: [
      {
        dateTime: daysAgo(3),
        symbol: 'ETH-PERP',
        tempOrderMode: ORDER_MODE.SELL,
        fillPrice: 2980.1,
        fillPriceDecimal: 2980.1,
        fillSize: 40,
        contractSize: 0.01,
        currency: 'ETH',
        feeCurrency: 'USDT',
        fee: 3.576,
        positionRemaining: 20,
        realizedPnl: -56.1,
        total: -59.676
      },
      {
        dateTime: daysAgo(3) + 1500,
        symbol: 'ETH-PERP',
        tempOrderMode: ORDER_MODE.BUY,
        fillPrice: 2979.4,
        fillPriceDecimal: 2979.4,
        fillSize: 20,
        contractSize: 0.01,
        currency: 'ETH',
        feeCurrency: 'USDT',
        fee: 1.788,
        positionRemaining: 0,
        realizedPnl: -28.1,
        total: -29.888
      }
    ]
  },
  // 一般 LIMIT SELL，正報酬 → 驗 colorSide 綠字分支 + 大數字千分位格式
  {
    orderId: 'MOCKFUT00000006',
    dateTime: daysAgo(5),
    symbol: 'BTC-PERP',
    tempOrderMode: ORDER_MODE.BUY,
    orderType: ORDER_TYPE.LIMIT,
    orderDetailType: '',
    fillPrice: 61890.75,
    fillPriceDecimal: 61890.75,
    orderPrice: 61890.75,
    orderPriceDecimal: 61890.75,
    fillSize: 500,
    orderSize: 500,
    contractSize: 0.001,
    currency: 'BTC',
    feeCurrency: 'USDT',
    fee: 30.945,
    positionRemaining: 525,
    realizedPnl: 245.8,
    total: 214.855,
    walletName: 'CROSS',
    futureTradeHistories: []
  }
]

// ─── net amount / realized pnl 懸浮明細（futuresTradeHistoryDetail）─────────────
// 只需要覆蓋展開會被 hover 到的那幾筆；沒列到的 orderId 回空陣列即可
// （TradeHistoryListRow.vue:562-566：長度 0 就顯示「查無明細」，不是壞掉)。
const HOVER_DETAIL_BY_ORDER_ID = {
  MOCKFUT00000002: [
    { asset: 'ETH', amount: -0.05, assetPrice: 3120.25, value: -156.01, fiat: false },
    { asset: 'USDT', amount: 143.4, assetPrice: 1, value: 143.4, fiat: true }
  ],
  MOCKFUT00000005: [
    { asset: 'ETH', amount: -0.6, assetPrice: 2980.1, value: -1788.06, fiat: false },
    { asset: 'USDT', amount: 1698.5, assetPrice: 1, value: 1698.5, fiat: true }
  ],
  MOCKFUT00000006: [
    { asset: 'BTC', amount: 0.5, assetPrice: 61890.75, value: 30945.38, fiat: false },
    { asset: 'USDT', amount: -30730.5, assetPrice: 1, value: -30730.5, fiat: true }
  ]
}

// ─── 分類 Tab（inquire/futureTradeCategorySummary）─────────────────────────
// 只需要撐起分類篩選用的 symbol 清單，跟 CategorySummary type 對齊
// （src/types/futures.ts:288-293）。
const CATEGORY_SUMMARY = [
  { categoryId: 1, categoryName: 'Popular', totalCount: 3, symbols: ['BTC-PERP', 'ETH-PERP', 'SOL-PERP'] },
  { categoryId: 2, categoryName: 'All', totalCount: 3, symbols: ['BTC-PERP', 'ETH-PERP', 'SOL-PERP'] }
]

export default function register(app) {
  app.get('/futures/api/inquire/futureTradeCategorySummary', (req, res) => {
    res.locals._mockLabel = `futureTradeCategorySummary (${CATEGORY_SUMMARY.length} categories)`
    res.json(envelope(CATEGORY_SUMMARY))
  })

  app.get('/futures/api/inquire/futureTradeHistory', (req, res) => {
    const { orderMode, marketName, categoryId } = req.query
    const pageNumber = Number(req.query.pageNumber) || 1
    const pageSize = Number(req.query.pageSize) || 10

    let rows = ROWS
    if (orderMode === 'BUY') rows = rows.filter((row) => row.tempOrderMode === ORDER_MODE.BUY)
    if (orderMode === 'SELL') rows = rows.filter((row) => row.tempOrderMode === ORDER_MODE.SELL)
    if (marketName) rows = rows.filter((row) => row.symbol === marketName)
    // categoryId 目前的分類都涵蓋全部 mock symbol，這裡不做進一步過濾——
    // 真的要驗證分類篩選，改 CATEGORY_SUMMARY 的 symbols 讓它們不重疊。
    void categoryId

    const total = rows.length
    const pagesAvailable = Math.max(Math.ceil(total / pageSize), 1)
    const pageItems = rows.slice((pageNumber - 1) * pageSize, pageNumber * pageSize)

    res.locals._mockLabel = `futureTradeHistory orderMode=${orderMode || 'ALL_MODES'} marketName=${marketName || 'ALL'} → ${total} rows (page ${pageNumber}/${pagesAvailable})`
    res.json(envelope({ pageItems, total, pagesAvailable }))
  })

  app.get('/futures/api/inquire/futureTradeHistoryDetail', (req, res) => {
    const { orderId } = req.query
    const detail = HOVER_DETAIL_BY_ORDER_ID[orderId] || []
    res.locals._mockLabel = `futureTradeHistoryDetail orderId=${orderId} → ${detail.length} rows`
    res.json(envelope(detail))
  })
}
