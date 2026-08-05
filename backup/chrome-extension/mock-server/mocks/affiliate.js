// Mock for the Affiliate (referral v3) 頁面 —— 用來驗證 NexU 隱藏 commission UI 的改動
// (PLAT-36976 / WLB-361)。改這個檔案 → hot reload 自動生效。
//
// 為什麼需要這支：
//   真正決定「這個帳號是不是 affiliate」的是 POST user/account 回的 referralIdentity。
//   測試帳號是 'basic'，所以 Affiliate.vue 的 runtime redirect 會把 /affiliate/* 全部
//   踢回 apply-form。這裡把它 patch 成 'premium' 就能進 affiliate 區域。
//
// user/account 走「proxy 真後端 + 只改一個欄位」而不是整包 mock，因為那個 payload 很大、
// 前端到處都在讀，整包假造反而更容易壞。其餘 affiliate list 類 API 因為測試帳號本來就
// 沒有下線資料（真後端會回空或 403），所以直接給假資料。
import express from 'express'
import { tamper, asJson } from './_helpers.js'

const jsonParser = express.json()

// ─── 設定常數（要改就動這幾個）─────────────────────────────
// 這幾個 rate 會變成 Upgrade to Partner dialog 裡「你最多能分出去多少」的上限
// (accountInfo.referralOwnedRate)，設 0 的話輸入框的 max 會是 0。
const OWNED_RATE = {
  spotRate: 0.3,
  futuresRate: 0.3,
  cwMakerRate: 0.2,
  cwTakerRate: 0.2
}

const envelope = (data) => ({
  code: 1,
  msg: 'Success',
  time: Date.now(),
  data,
  success: true
})

const paginated = (rows) =>
  envelope({
    totalRows: rows.length,
    currentPage: 1,
    totalPages: 1,
    data: rows
  })

// ─── user/account：proxy 真後端後只改 referralIdentity / referralOwnedRate ────
// 這是 HTTP tamper mode 的實例：整包 payload 很大、前端到處在讀，所以不整包假造，
// 而是 proxy 真後端後只 patch 需要的欄位（非 JSON / 出錯自動原樣放行，由 tamper 處理）。
// 用 app.post 精確匹配而不是 app.use：app.use 是前綴匹配，會把
// POST /api/user/account/wallet/transfer 一起攔下來，把 referralIdentity 注進
// 錢包轉帳的回應裡。這裡只要 POST /api/user/account 這一支。
function registerAccountPatch(app, defaultApiDomain) {
  app.post(
    '/api/user/account',
    tamper(defaultApiDomain, {
      label: 'user/account',
      modify: asJson((body, { res }) => {
        if (body?.data) {
          body.data.referralIdentity = 'premium'
          body.data.referralOwnedRate = {
            ...(body.data.referralOwnedRate || {}),
            ...OWNED_RATE
          }
          res.locals._mockLabel = 'user/account patched → referralIdentity=premium'
        } else {
          res.locals._mockLabel = 'user/account (no .data, untouched)'
        }
      })
    })
  )
}

// ─── User List ────────────────────────────────────────────
// roleStatus 要是 DIRECT_USER + upgradable=true，UserActions.vue 才會顯示
// 「Upgrade to Partner」入口（isDirectRoleUser && isEnableUpgrade）。
// 另外 isShowAction 是 accountInfo.uid !== info.uid，所以 uid 別跟登入帳號一樣。
const USER_ROWS = [
  {
    uid: '8428973355',
    referralCode: 'NEXU01',
    // 這幾個 rate 欄位在 NexU 應該完全不顯示（isShowAffiliateCommission=false）
    spotRate: 0.12,
    futuresRate: 0.15,
    cwMakerRate: 0.08,
    cwTakerRate: 0.09,
    upperPartner: '8100000001',
    registrationTime: 1750000000000,
    firstTradingTime: 1755000000000,
    kycStatus: 2,
    note: 'mock user A',
    roleStatus: 'DIRECT_USER',
    upgradable: true,
    parentUid: '8100000001',
    availableUpdateTime: 0
  },
  {
    uid: '8428973356',
    referralCode: 'NEXU01',
    spotRate: 0.1,
    futuresRate: 0.1,
    cwMakerRate: 0.05,
    cwTakerRate: 0.05,
    upperPartner: '8100000001',
    registrationTime: 1752000000000,
    firstTradingTime: null,
    kycStatus: 2,
    note: '',
    roleStatus: 'DIRECT_USER',
    upgradable: true,
    parentUid: '8100000001',
    availableUpdateTime: 0
  }
]

// ─── Link Management / Customer Links ─────────────────────
// 每一列都刻意帶滿 commission 欄位 + tradedUsers，這樣「NexU 應該看不到它們」
// 才是有意義的驗證（如果 mock 不給這些欄位，欄位消失就證明不了什麼）。
const LINK_ROWS = [
  {
    referralCode: 'NEXU01',
    shortLink: 'https://nexuwallet.com/r/NEXU01',
    isDefault: true,
    spotRate: 0.3,
    mySpotCommissionRate: 0.2,
    refereeSpotCommissionRate: 0.1,
    futuresRate: 0.3,
    myFuturesCommissionRate: 0.2,
    refereeFuturesCommissionRate: 0.1,
    cwMakerRate: 0.2,
    myCwMakerCommissionRate: 0.15,
    refereeCwMakerCommissionRate: 0.05,
    cwTakerRate: 0.2,
    myCwTakerCommissionRate: 0.15,
    refereeCwTakerCommissionRate: 0.05,
    referredUsers: 42,
    tradedUsers: 17,
    name: 'Default link'
  },
  {
    referralCode: 'NEXU02',
    shortLink: 'https://nexuwallet.com/r/NEXU02',
    isDefault: false,
    spotRate: 0.25,
    mySpotCommissionRate: 0.15,
    refereeSpotCommissionRate: 0.1,
    futuresRate: 0.25,
    myFuturesCommissionRate: 0.15,
    refereeFuturesCommissionRate: 0.1,
    cwMakerRate: 0.18,
    myCwMakerCommissionRate: 0.12,
    refereeCwMakerCommissionRate: 0.06,
    cwTakerRate: 0.18,
    myCwTakerCommissionRate: 0.12,
    refereeCwTakerCommissionRate: 0.06,
    referredUsers: 8,
    tradedUsers: 3,
    name: 'Campaign link'
  }
]

const DELETED_LINK_ROWS = LINK_ROWS.map((row, index) => ({
  ...row,
  referralCode: `NEXUDEL${index + 1}`,
  deleteTime: 1756000000000 + index * 86400000
}))

// ─── Partner List ─────────────────────────────────────────
// 需要有列才點得到 Action → Edit Partner Details（EditCommissionRateDialog）。
const PARTNER_ROWS = [
  {
    uid: '8100000001',
    nickname: 'Mock Partner A',
    upperPartner: '8000000000',
    upperLevelPartnerUid: '8000000000',
    referralCode: 'NEXUP01',
    // 費率欄位刻意給值：NexU 應該完全不顯示
    spotRate: 0.18,
    futuresRate: 0.2,
    cwMakerRate: 0.1,
    cwTakerRate: 0.12,
    creationTime: 1748000000000,
    totalUsers: 12,
    note: 'mock partner',
    availableUpdateTime: 0,
    activatedTime: 0
  }
]

// ─── Affiliate Dashboard ──────────────────────────────────
// partnerOverview 同時餵 summary row（totalUsers / totalCommission）、
// My Referral Link 的 referralCode，以及 ReferralCommissionPanel 的費率灰卡。
const PARTNER_OVERVIEW = {
  referralCode: 'NEXU01',
  totalUsers: 7,
  totalCommission: 1234.56,
  spotRate: 0.3,
  futuresRate: 0.3,
  cwMakerRate: 0.2,
  cwTakerRate: 0.2,
  spotMyCommissionRate: 0.2,
  spotDirectReferralCommissionRate: 0.1,
  futuresMyCommissionRate: 0.2,
  futuresDirectReferralCommissionRate: 0.1,
  cwMakerMyCommissionRate: 0.15,
  cwMakerDirectReferralCommissionRate: 0.05,
  cwTakerMyCommissionRate: 0.15,
  cwTakerDirectReferralCommissionRate: 0.05
}

// My Referees 折線圖。三組都給，這樣「First Trade 有沒有被拿掉」才驗得出來。
const buildSeries = (base) =>
  Array.from({ length: 10 }, (_, i) => ({
    timestamp: 1756000000000 + i * 86400000,
    total: base + i * base * 0.1
  }))

// gain 是「已經是百分比數值」，給 25 才會顯示成 +25%（對齊 Figma），給 0.25 會變 +0.25%
const REFERRAL_OVERVIEW = {
  registration: { periodTotal: 7, gain: 25, data: buildSeries(2000) },
  firstDeposit: { periodTotal: 4, gain: 10, data: buildSeries(1200) },
  firstTrade: { periodTotal: 3, gain: 5, data: buildSeries(800) }
}

// ─── Register routes ──────────────────────────────────────
export default function register(app, { defaultApiDomain } = {}) {
  if (!defaultApiDomain) {
    throw new Error('affiliate mock: defaultApiDomain is required')
  }

  registerAccountPatch(app, defaultApiDomain)

  // User List
  app.get('/api/user/referral/userList', (req, res) => {
    res.locals._mockLabel = `userList (${USER_ROWS.length} rows, upgradable)`
    res.json(paginated(USER_ROWS))
  })
  app.get('/api/user/referral/userList/dropdowns', (req, res) => {
    res.locals._mockLabel = 'userList/dropdowns'
    res.json(
      envelope({
        uids: USER_ROWS.map((row) => row.uid),
        uidNamePairs: USER_ROWS.map((row) => ({
          uid: row.uid,
          name: row.uid
        })),
        parentUidNamePairs: [],
        referralCodes: ['NEXU01']
      })
    )
  })

  // Link Management（getSelfLinks 直接回陣列，不是分頁物件）
  app.get('/api/user/referral/selfLink', (req, res) => {
    res.locals._mockLabel = `selfLink (${LINK_ROWS.length} rows)`
    res.json(envelope(LINK_ROWS))
  })

  // Deleted Link
  app.get('/api/user/referral/deletedLink', (req, res) => {
    res.locals._mockLabel = `deletedLink (${DELETED_LINK_ROWS.length} rows)`
    res.json(paginated(DELETED_LINK_ROWS))
  })

  // Upgrade to Partner：回成功，讓 success dialog 跑得出來
  app.post('/api/user/referral/partner', jsonParser, (req, res) => {
    res.locals._mockLabel = `upgradeToPartner uid=${req.body?.uid} spot=${req.body?.spotRate} futures=${req.body?.futuresRate} cwMaker=${req.body?.cwMakerRate} cwTaker=${req.body?.cwTakerRate}`
    res.json(envelope(null))
  })

  // ─── Partner List ───────────────────────────────────────
  // 注意註冊順序：partner/rate/limit、partner/rate、partner/dropdowns 都要在
  // GET /partner 之前註冊，否則 express 會用不到（路徑不同其實不衝突，但保持順序
  // 一致比較好讀）。
  app.get('/api/user/referral/partner/rate/limit', (req, res) => {
    res.locals._mockLabel = `partner/rate/limit uid=${req.query?.partnerUid}`
    res.json(
      envelope({
        spotRateLowerLimit: 0,
        spotRateUpperLimit: 0.3,
        futuresRateLowerLimit: 0,
        futuresRateUpperLimit: 0.3,
        cwMakerRateLowerLimit: 0,
        cwMakerRateUpperLimit: 0.2,
        cwTakerRateLowerLimit: 0,
        cwTakerRateUpperLimit: 0.2
      })
    )
  })
  // Edit Partner Details 送出 → 成功，才看得到 Update Result modal
  app.patch('/api/user/referral/partner/rate', jsonParser, (req, res) => {
    res.locals._mockLabel = `editCommissionRate uid=${req.body?.partnerUid} name=${req.body?.partnerName}`
    res.json(envelope(null))
  })
  app.get('/api/user/referral/partner/dropdowns', (req, res) => {
    res.locals._mockLabel = 'partner/dropdowns'
    res.json(
      envelope({
        uids: PARTNER_ROWS.map((row) => row.uid),
        uidNamePairs: PARTNER_ROWS.map((row) => ({
          uid: row.uid,
          name: row.nickname
        })),
        parentUidNamePairs: [],
        referralCodes: PARTNER_ROWS.map((row) => row.referralCode)
      })
    )
  })
  app.get('/api/user/referral/partner', (req, res) => {
    res.locals._mockLabel = `partner (${PARTNER_ROWS.length} rows)`
    res.json(paginated(PARTNER_ROWS))
  })

  // ─── Accessible functions ───────────────────────────────
  // 沒有這個，Affiliate 側邊欄不會出現 Performance / Deposits & Withdrawals tab
  // （Affiliate.vue 的 hide 條件看 accessibleFunctions）。
  app.get('/api/function/list', (req, res) => {
    res.locals._mockLabel = 'function/list (+AFFILIATE_PERFORMANCE)'
    res.json(
      envelope([
        'API_ACCESS',
        'EXPRESS_BUY_ENTRY',
        'EXPRESS_SELL_ENTRY',
        'WITHDRAW_SELF_CRYPTO',
        'EXPRESS_BUY_CASHTELLER_CASHTELLER',
        'EXPRESS_SELL_CASHTELLER_CASHTELLER',
        'AFFILIATE_PERFORMANCE',
        'AFFILIATE_DEPOSIT_WITHDRAW'
        // 刻意不給 COPYWISE：NexU 的 enableCopyWise 是編譯期 false，給了也不會生效
      ])
    )
  })

  // ─── Performance ────────────────────────────────────────
  app.get('/api/user/referral/performance/summary', (req, res) => {
    res.locals._mockLabel = 'performance/summary'
    res.json(
      envelope({
        // 舊的 commission / self-rebate / trading 指標刻意給值：NexU 應該都不顯示
        commission: { total: 5000, direct: 3000, indirect: 2000 },
        selfRebate: 800,
        tradingFee: { total: 12000, direct: 7000, indirect: 5000 },
        tradingVolume: { total: 900000, direct: 500000, indirect: 400000 },
        netDeposit: 45000
      })
    )
  })
  app.get('/api/user/referral/performance/details', (req, res) => {
    const rows = [
      {
        partnerUid: '8428973356',
        partnerNickname: 'Jessi',
        partnerLevel: 2,
        partnerRole: 'PARTNER',
        upperPartner: '8428973355',
        upperPartnerNickname: 'Joquey',
        // commission 欄位給值：NexU 應該一個都看不到
        totalCommission: 2000,
        totalDirectCommission: 1200,
        totalTradingCommission: 800,
        directTradingCommission: 500,
        totalCopyWiseCommission: 300,
        copyWiseCommission: 200,
        spotCommission: 400,
        futuresCommission: 400,
        totalDeposit: 30000,
        totalWithdraw: 10000,
        totalNetDeposit: 20000,
        netDeposit: 20000
      }
    ]
    res.locals._mockLabel = `performance/details (${rows.length} rows)`
    res.json(envelope({ totalRows: rows.length, data: rows }))
  })

  // ─── Affiliate Dashboard ────────────────────────────────
  app.get('/api/user/referral/partnerOverview', (req, res) => {
    res.locals._mockLabel = `partnerOverview (totalUsers=${PARTNER_OVERVIEW.totalUsers})`
    res.json(envelope(PARTNER_OVERVIEW))
  })
  app.get('/api/user/referral/referrals', (req, res) => {
    res.locals._mockLabel = 'referrals (registration/firstDeposit/firstTrade)'
    res.json(envelope(REFERRAL_OVERVIEW))
  })
  // 這三支對應的 UI 在 NexU 應該都不顯示；留著 mock 是為了「如果它們被呼叫到
  // 就代表元件還在渲染」，可以當成回歸訊號（server log 會印出來）。
  app.get('/api/user/referral/recentRegistered', (req, res) => {
    res.locals._mockLabel = '⚠️ recentRegistered 被呼叫（NexU 應該不顯示 Recent Referrals）'
    res.json(envelope([]))
  })
  app.get('/api/user/referral/commissionOverview', (req, res) => {
    res.locals._mockLabel = '⚠️ commissionOverview 被呼叫（NexU 應該不顯示 My Earnings）'
    res.json(envelope({ totalCommission: 0, data: [] }))
  })
  app.get('/api/user/referral/totalCommission', (req, res) => {
    res.locals._mockLabel = '⚠️ totalCommission 被呼叫（NexU 應該不顯示 Leaderboard）'
    res.json(envelope({ data: [] }))
  })
}
