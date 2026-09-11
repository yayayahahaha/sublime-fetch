// Mock for Spot Trade History 頁面（src/views/order/spot/trade-history/index.vue）。
//
// 為什麼會有這支：驗證 PLAT-29442 疑似遺留的 bug —— fedhabit（enableGstAndTds=true）
// 的 Trading Fee 欄位少了 currency badge。src/components/order/spot/TradeHistoryListRow.vue
// 的 fee cell 有兩個分支：
//   v-if="enableGstAndTds"（fedhabit 走這條）  → line 73-82，只有數字，沒有
//     <span class="badger">{{ data.feeCurrency }}</span>
//   v-else（BTSE 等其他 brand 走這條）        → line 106-115，數字 + badge
// 兩個分支目前給的 feeCurrency 值故意設成一樣（都是 'USDT'），這樣畫面上「有沒有出現
// USDT 字樣」才是唯一變因，不會被不同幣別混淆判斷。
//
// 整包 respond：一般測試帳號的 spot 成交紀錄不保證能覆蓋到 GST/TDS 欄位和展開明細，
// 所以直接假造，比 tamper 改欄位更直接可控。
//
// 欄位對照 TradeHistoryListRow.vue 的 SpotTradeHistoryRecord 用法：
//   orderType 是單字母（SPOT_ORDER_TYPE：L=Limit / M=Market / O=OTC / P=Index，
//   對應 i18n key t.orderType_l 等，src/i18n/en.json:2156-2159）。
//   orderMode 是 SPOT_ORDER_MODE：B=Buy / S=Sell。

const envelope = (data) => ({
  code: 1,
  msg: 'Success',
  time: Date.now(),
  data,
  success: true
})

const DAY = 86400000
const daysAgo = (n) => Date.now() - n * DAY

// ─── 主列表（histories/spotTrades 的 data）───────────────────────────────
const ROWS = [
  // 一般 LIMIT BUY，無展開明細 —— fee/gst/tds 都給值，用來看 fee 那欄有沒有 USDT badge
  {
    orderId: 'MOCKSPOT00000001',
    transactionUnixtime: daysAgo(0),
    fsCurrency: 'BTC',
    priceCurrency: 'USDT',
    orderType: 'L',
    orderDetailType: '',
    orderMode: 'B',
    fillPrice: 62350.5,
    fillPriceDecimal: 62350.5,
    orderPrice: 62350.5,
    orderPriceDecimal: 62350.5,
    fillSize: 0.05,
    orderSize: 0.05,
    feeAmount: 3.1175,
    feeCurrency: 'USDT',
    gstAmount: 0.5612,
    tdsAmount: 0.0312,
    netAmount: 3117.87,
    netCurrency: 'USDT',
    void: false,
    list: []
  },
  // MARKET SELL，有展開明細（list 2 筆）—— 一起驗證子列的 fee badge 分支
  {
    orderId: 'MOCKSPOT00000002',
    transactionUnixtime: daysAgo(1),
    fsCurrency: 'ETH',
    priceCurrency: 'USDT',
    orderType: 'M',
    orderDetailType: '',
    orderMode: 'S',
    fillPrice: 3120.25,
    fillPriceDecimal: 3120.25,
    orderPrice: null,
    orderPriceDecimal: null,
    fillSize: 1.2,
    orderSize: 1.2,
    feeAmount: 3.7443,
    feeCurrency: 'USDT',
    gstAmount: 0.6740,
    tdsAmount: 0.0374,
    netAmount: 3740.66,
    netCurrency: 'USDT',
    void: false,
    list: [
      {
        orderId: 'MOCKSPOT00000002-1',
        orderPrice: 3121.0,
        priceCurrency: 'USDT',
        fillSize: 0.7,
        feeAmount: 2.1847,
        feeCurrency: 'USDT',
        gstAmount: 0.3932,
        tdsAmount: 0.0218,
        netAmount: 2181.53,
        netCurrency: 'USDT'
      },
      {
        orderId: 'MOCKSPOT00000002-2',
        orderPrice: 3119.2,
        priceCurrency: 'USDT',
        fillSize: 0.5,
        feeAmount: 1.5596,
        feeCurrency: 'USDT',
        gstAmount: 0.2808,
        tdsAmount: 0.0156,
        netAmount: 1559.13,
        netCurrency: 'USDT'
      }
    ]
  },
  // TWAP，驗 subtype 那一行；void=true 順便驗 showVoidTag（若 brand 開 enableDisplayVoidTradeHistory）
  {
    orderId: 'MOCKSPOT00000003',
    transactionUnixtime: daysAgo(2),
    fsCurrency: 'SOL',
    priceCurrency: 'USDT',
    orderType: 'M',
    orderDetailType: 'TWAP',
    orderMode: 'B',
    fillPrice: 148.32,
    fillPriceDecimal: 148.32,
    orderPrice: 148.32,
    orderPriceDecimal: 148.32,
    fillSize: 20,
    orderSize: 20,
    feeAmount: 1.4832,
    feeCurrency: 'USDT',
    gstAmount: 0.2670,
    tdsAmount: 0.0148,
    netAmount: 2965.16,
    netCurrency: 'USDT',
    void: true,
    list: []
  }
]

export default function register(app) {
  app.get('/api/histories/spotTrades', (req, res) => {
    const { orderMode, base, quote } = req.query
    const currentPage = Number(req.query.currentPage) || 1
    const pageSize = Number(req.query.pageSize) || 10

    let rows = ROWS
    if (orderMode === 'BUY') rows = rows.filter((row) => row.orderMode === 'B')
    if (orderMode === 'SELL') rows = rows.filter((row) => row.orderMode === 'S')
    if (base) rows = rows.filter((row) => row.fsCurrency === base)
    if (quote) rows = rows.filter((row) => row.priceCurrency === quote)

    const totalRows = rows.length
    const totalPages = Math.max(Math.ceil(totalRows / pageSize), 1)
    const data = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize)

    res.locals._mockLabel = `spotTrades orderMode=${orderMode || 'ALL_MODES'} base=${base || 'ALL'} quote=${quote || 'ALL'} → ${totalRows} rows (page ${currentPage}/${totalPages})`
    res.json(envelope({ data, totalRows, totalPages }))
  })
}
