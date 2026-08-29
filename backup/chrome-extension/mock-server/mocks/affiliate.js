// Mock for the Affiliate (referral v3) 頁面 —— PLAT-36976 / WLB-361。
// 改這個檔案 → hot reload 自動生效。
//
// ─── 定位與邊界（先讀這段）─────────────────────────────────
// 這支 mock 是 **NexU 專用**的。存在的理由只有兩個：
//   1. 繞過測試帳號拿不到的前置條件（referralIdentity 是 basic、沒有下線資料、
//      ops 的 function_control 還沒配好之類）
//   2. 在後端 API 還沒好之前先讓前端能開發
//
// 所以它的目標是「**盡量貼近真實 API**」，不是「湊出一組能讓畫面有東西的資料」。
// 由此推出三條規則：
//
//   - 真實值可知的時候就對齊它 —— 可知的來源有兩個：後端的 api doc、以及拿
//     localhost:8081（BTSE 品牌 + 真後端）實測共享端點。兩者衝突時記下來去問後端。
//   - 刻意偏離真實的地方，一定在旁邊寫「為什麼」。沒寫理由的偏離就是 bug。
//   - **不要用「別的品牌可能會用到」來合理化假資料** —— 沒有別的品牌會用這台 mock。
//     以前 OWNED_RATE 給 0.3/0.2 就是踩到這個：理由寫成「讓輸入框有可填範圍」，
//     但那些輸入框在 NexU 全部被 flag 藏掉，等於為了一個不存在的場景讓 mock 說謊。
//
// 特別注意「mock 比真後端寬鬆」這種偏離最危險：真後端會炸的地方在 mock 上永遠重現不出來。
// （踩過兩次：referrals.firstDeposit 多給了 periodTotal/gain；series 的值給 number 而真後端是 string。）
//
// 反過來「刻意給滿」是有意義的：費率欄位、tradedUsers、firstTradingTime 這些真後端對
// NexU 不回的欄位，這裡故意給值，這樣「畫面上沒有它們」才證明得了是前端 flag 藏起來的。
//
// 為什麼需要這支：
//   真正決定「這個帳號是不是 affiliate」的是 POST user/account 回的 referralIdentity。
//   測試帳號是 'basic'，所以 Affiliate.vue 的 runtime redirect 會把 /affiliate/* 全部
//   踢回 apply-form。把它 patch 成 'premium' 就能進 affiliate 區域。
//
// 申請流程的各個階段用底下的 SCENARIO 切換（affiliate / applied / rejected /
// neverApplied），它同時決定 referralIdentity 和 affiliateStatus 的回傳。
//
// user/account 走「proxy 真後端 + 只改一個欄位」而不是整包 mock，因為那個 payload 很大、
// 前端到處都在讀，整包假造反而更容易壞。其餘 affiliate list 類 API 因為測試帳號本來就
// 沒有下線資料（真後端會回空或 403），所以直接給假資料。
import express from 'express'
import { tamper, asJson } from './_helpers.js'

const jsonParser = express.json()

// ─── 總開關：只留「進得去」的前置條件，資料一律走真後端 ──────
// true  → 只掛 user/account 的 identity patch，其餘 affiliate 端點一條都不註冊，
//         全部落到 catch-all proxy → 看到的資料就是真後端的實際回傳。
// false → 正常掛上底下所有 mock。
//
// 為什麼 true 時還是要留 identity patch：那不是「假造資料」，而是「繞過測試帳號拿不到的
// 前置條件」（真實帳號的 referralIdentity 是 basic，Affiliate.vue 會把 /affiliate/* 全部
// 踢回 apply-form，根本進不去頁面、也就看不到真資料）。這正是這支 mock 存在的第一個理由。
//
// 用途：後端上線後先切 true、對照真 API 看哪裡壞掉，再決定還需要 mock 什麼。
// 也可以拿別的品牌（例如 8081 跑 CTX-98）驗共享版端點的回傳，這時 identity patch 更是必要。
const BYPASS_ALL = false

// ─── 情境開關（最常要動的就是這個）─────────────────────────
// 決定「登入的這個帳號處在 affiliate 申請流程的哪一階段」。改這個值 → hot reload 生效。
//
//   'affiliate'   已通過審核。referralIdentity=premium，可以進 /affiliate/*，
//                 apply-form 會被 Affiliate.vue 導去 dashboard。
//   'applied'     表單已送出、等待審核。referralIdentity=basic，
//                 apply-form 顯示 AlreadyAppliedDialog（不顯示表單本身）。
//   'rejected'    申請被拒。apply-form 顯示 ApplyFailedDialog。
//   'neverApplied' 從未申請。apply-form 顯示空白表單，可以實際送出。
//
// 為什麼 scenario 要同時管 user/account 和 affiliateStatus 兩支：
//   ApplyForm.vue:195-197 的判斷是 `!isAffiliateUser && isAffiliateApplied`，
//   兩個條件分別來自 user/account 的 referralIdentity 和 affiliateStatus 的
//   history.lastStatus。只改一支的話會互相打架（premium 會讓 apply-form 直接跳走，
//   永遠看不到 AlreadyAppliedDialog）。
const SCENARIO = 'affiliate'

// ─── B1（重複申請靜默失敗）驗證用的臨時開關 ──────────────────
// 設成 -1046（已 pending/approved）或 -1051（已是 partner）
//   → POST applyAffiliateForm 回該拒絕碼，用來驗 ApplyForm.vue 的「已申請」dialog
// 設成 null → 正常回成功（平時就放 null）
//
// 要看到表單才送得出去，所以上面的 SCENARIO 必須是 'neverApplied'。
const APPLY_FORM_FORCE_ERROR = null

// ─── function/list 要不要 mock ────────────────────────────────
// false（預設）→ 不 mock，落到 proxy 去問真後端。這樣側邊欄的 Performance /
//   Deposits & Withdrawals tab 有沒有出現，就直接反映 ops 在
//   function_control_whitelabel 裡到底配好了沒。
// true → 用下面寫死的清單（含 AFFILIATE_PERFORMANCE / AFFILIATE_DEPOSIT_WITHDRAW），
//   在 ops 還沒配好時強行把 tab 打開，好先驗頁面本身。
//
// ⚠️ 這支被 mock 蓋掉時，畫面上一定看得到 tab —— 也就是說開著 mock 就驗不出真實配置。
const MOCK_FUNCTION_LIST = false

// 對應 src/api/referral.ts 的 REFERRAL_AFFILIATE_FORM_STATUS
const FORM_STATUS = {
  neverApply: -1,
  pending: 0,
  reject: 1,
  approve: 2
}

const SCENARIO_CONFIG = {
  affiliate: { identity: 'premium', formStatus: FORM_STATUS.approve },
  applied: { identity: 'basic', formStatus: FORM_STATUS.pending },
  rejected: { identity: 'basic', formStatus: FORM_STATUS.reject },
  neverApplied: { identity: 'basic', formStatus: FORM_STATUS.neverApply }
}

const scenario = SCENARIO_CONFIG[SCENARIO]
if (!scenario) {
  throw new Error(
    `affiliate mock: 未知的 SCENARIO '${SCENARIO}'，可用值：${Object.keys(SCENARIO_CONFIG).join(' / ')}`
  )
}

// ─── 設定常數（要改就動這幾個）─────────────────────────────
// 登入帳號的 uid。partner/dropdowns 的第一筆一定要用這個值，Performance 的
// setInitialPartner() 才找得到對應 option（詳見那支的註解）。換測試帳號要一起改，
// 拿法：devtools console 打 $store.getters.userUID。
//
// ⚠️ 不能和 PERFORMANCE_ROWS 裡任何一列的 uid 相同 —— 那些列是「下線」，
// 撞號的話同一個人會同時是 root 和自己的下線，Upline Partner / Level 會顯示錯。
const LOGIN_UID = 'NXU8419937063'

// accountInfo.referralOwnedRate —— 對齊真實 nexu 的值。
//
// 後端 2026-08-14 回覆（填充點 UserServiceImpl.java:1465-1469，資料源是 affiliate_code
// 的 OWNED 行）：
//   已升級 partner 的 nexu 用戶 → 四項 = 0（升級時寫死 0 落庫再讀回）
//   未升級（無 OWNED 碼）的用戶 → 四項 = null（DTO 是包裝類 Double）
// SCENARIO 是 'affiliate'（已通過審核 = partner），所以這裡給 0。
//
// 為什麼不像以前那樣給 0.3/0.2「讓輸入框有可填範圍」：這幾個值只餵三個 dialog 的費率
// 輸入框上限（Upgrade to Partner / Create New Link / Edit Self Rebate），而那三處在
// nexu 全部被 flag 藏掉或到不了 —— 前兩個被 isShowTradeCommissionFields 和
// enableSpotTrade/enableFuturesTrade/enableCopyWise 擋，第三個 UserActions.isShowEditRate
// 直接回 false。給非 0 對 nexu 沒有任何作用，只會讓 mock 偏離真實。
//
// null 那條路不特別 mock：它屬於「還沒升級的普通使用者」，而他們進不了 /affiliate/*。
// 前端也吃得下 null（5 個消費點都有 `|| {}` / `|| 0`；Overview.vue 是靠自己那支
// formatPercentage 內的 BigNumber(value || 0)）。
const OWNED_RATE = {
  spotRate: 0,
  futuresRate: 0,
  cwMakerRate: 0,
  cwTakerRate: 0
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
//
// 非 affiliate 情境也要「主動寫成 basic」而不是放行：真後端帳號如果哪天被升級成
// premium，放行就會讓 apply-form 直接跳去 dashboard，情境靜悄悄失效。寫死才可重現。
function registerAccountPatch(app, defaultApiDomain) {
  app.post(
    '/api/user/account',
    tamper(defaultApiDomain, {
      label: 'user/account',
      modify: asJson((body, { res }) => {
        if (body?.data) {
          body.data.referralIdentity = scenario.identity
          body.data.referralOwnedRate = {
            ...(body.data.referralOwnedRate || {}),
            ...OWNED_RATE
          }
          res.locals._mockLabel = `user/account patched → referralIdentity=${scenario.identity} (${SCENARIO})`
        } else {
          res.locals._mockLabel = 'user/account (no .data, untouched)'
        }
      })
    })
  )
}

// ─── 申請狀態（affiliateStatus / applyAffiliateForm）──────────
// useReferralStore.getAffiliateApplication() 讀的是 response.history.lastStatus
// 和 response.history.data，ApplyForm.vue 的 initialize() 再據此決定顯示表單、
// AlreadyAppliedDialog 還是 ApplyFailedDialog。
//
// history.data 目前沒有任何元件在算繪（store 只存進 affiliateApplication.histories，
// 全庫沒有 reader），所以這裡的值不影響任何驗證。
//
// 但欄位名還是照 ApplyForm.vue:239-250 實際送出的 payload 給，不要自己編：
//   country / preferredName          —— 一律送
//   identity / promotePlan           —— enableAffiliateFormAdditionalInformation
//   preferredLanguage / detail       —— enableAffiliateFormPreferredContact
// 兩個 flag 在 baseConfig/referralConfig.js 預設 true、nexu 沒覆寫 → nexu 全都會送。
//
// ⚠️ 這是「請求」的欄位名，回傳 DTO 不保證同名（後端未提供 affiliateStatus 的
// 回傳結構）。id / status / createdTime / updatedTime 仍是我們推的。
const APPLICATION_HISTORY = [
  {
    id: 90001,
    status: FORM_STATUS.pending,
    country: 'HK',
    preferredName: 'Mock Applicant',
    identity: 'individual',
    promotePlan: 'mock server 造的推廣計畫描述',
    preferredLanguage: 'en',
    detail: 'mock server 造的聯絡方式備註',
    createdTime: Date.now() - 2 * 24 * 60 * 60 * 1000,
    updatedTime: Date.now() - 2 * 24 * 60 * 60 * 1000
  }
]

function registerApplicationStatus(app) {
  app.get('/api/user/referral/affiliateStatus', (req, res) => {
    // neverApply 時回空歷程：store 會把 status 設成 -1，兩個 computed 都是 false，
    // initialize() 就會落到 isShowForm = true。
    const isNeverApplied = scenario.formStatus === FORM_STATUS.neverApply
    const histories = isNeverApplied
      ? []
      : APPLICATION_HISTORY.map((item) => ({
          ...item,
          status: scenario.formStatus
        }))

    res.locals._mockLabel = `affiliateStatus lastStatus=${scenario.formStatus} (${SCENARIO})`
    res.json(
      envelope({
        history: {
          lastStatus: scenario.formStatus,
          data: histories
        }
      })
    )
  })

  // 送出申請 → 直接成功，才看得到 SubmittedSuccessDialog。
  // 真後端對已經是 partner 的帳號會回 -1051 拒絕（見 api doc A1），所以這支一定要 mock，
  // 否則 neverApplied 情境按下送出只會拿到錯誤。
  app.post('/api/user/referral/applyAffiliateForm', jsonParser, (req, res) => {
    if (APPLY_FORM_FORCE_ERROR != null) {
      const msg =
        APPLY_FORM_FORCE_ERROR === -1051
          ? 'the user is already a partner'
          : 'pending or approved'
      res.locals._mockLabel = `applyAffiliateForm → 強制回 ${APPLY_FORM_FORCE_ERROR}（B1 驗證）`
      return res.status(400).json(errorBody(APPLY_FORM_FORCE_ERROR, msg))
    }
    res.locals._mockLabel = `applyAffiliateForm country=${req.body?.country} name=${req.body?.preferredName}`
    res.json(envelope(null))
  })
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
    registrationTime: 1750000000000,
    firstTradingTime: 1755000000000,
    // firstExpressBuyTime 取代 firstTradingTime。兩個都留著：NexU 只會看到
    // firstExpressBuyTime、其他品牌只會看到 firstTradingTime，所以兩個都給值才驗得出
    // 「該藏的藏了、該顯示的顯示了」。
    //
    // ⚠️ 2026-08-20 改名（first-express-buy-前端字段变更.md）：
    //   firstDepositTime → firstExpressBuyTime
    //   口径也翻轉：原本是「一般入金 type=1、排除 Express Buy」，
    //   現在是「首筆 Express Buy type=49、排除所有 fiat/crypto 存款與 P2P」。
    //   UI 文案對外叫 "Cash Teller"（客戶用語），欄位名維持內部詞 expressBuy。
    // ⚠️ staging (nexu-api.btse.co) 2026-08-20 實測仍回舊名 firstDepositTime —— 後端還在
    //   code review。所以這裡先走新名，前端接 staging 會是壞的，等後端部署才會對上。
    firstExpressBuyTime: 1756000000000,
    // kycStatus 是 int（8081 實測：0 / 2），不是 string enum
    kycStatus: 2,
    note: 'mock user A',
    roleStatus: 'DIRECT_USER',
    upgradable: true,
    level: 1,
    parentUid: '8100000001',
    parentName: 'Mock Partner A (direct)',
    // 8081 實測：沒有冷卻時是 null（不是 0）
    availableUpdateTime: null
  },
  {
    uid: '8428973356',
    referralCode: 'NEXU01',
    spotRate: 0.1,
    futuresRate: 0.1,
    cwMakerRate: 0.05,
    cwTakerRate: 0.05,
    registrationTime: 1752000000000,
    firstTradingTime: null,
    firstExpressBuyTime: null, // 沒做過 Express Buy → 表格該顯示 '-'
    kycStatus: 0,
    note: '',
    roleStatus: 'DIRECT_USER',
    upgradable: true,
    level: 1,
    parentUid: '8100000001',
    parentName: 'Mock Partner A (direct)',
    availableUpdateTime: null
  }
]

// ─── Link Management / Customer Links ─────────────────────
// 每一列都刻意帶滿 commission 欄位 + tradedUsers，這樣「NexU 應該看不到它們」
// 才是有意義的驗證（如果 mock 不給這些欄位，欄位消失就證明不了什麼）。
//
// ⚠️ shortLink 是 slug、不是完整 URL，域名由前端拼（8081 實測：referralCode='xNOk1ZYt'
// 搭 shortLink='testhahaha'）。而且它跟 referralCode 是兩個獨立的值 —— 這裡刻意給不一樣的
// 字串，才驗得出畫面上哪一欄讀的是哪一個。
const LINK_ROWS = [
  {
    referralCode: 'NEXU01',
    shortLink: 'nexulaunch',
    isDefault: true,
    updateTime: 1785914777766,
    deleteTime: null,
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
    // ⚠️ 2026-08-20 改名：depositedUsers → expressBuyUsers（口径同步翻成 type=49）。
    // UI 文案對外叫 "Cash Teller"。staging 實測仍回舊名，後端還在 code review。
    expressBuyUsers: 20 // 取代 tradedUsers
  },
  {
    referralCode: 'NEXU02',
    shortLink: 'nexucampaign',
    isDefault: false,
    updateTime: 1785914777766,
    deleteTime: null,
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
    expressBuyUsers: 5
  }
]

// 8081 實測：deletedLink 是分頁物件，而且被刪掉的連結 shortLink 會是 null
const DELETED_LINK_ROWS = LINK_ROWS.map((row, index) => ({
  ...row,
  referralCode: `NEXUDEL${index + 1}`,
  shortLink: null,
  isDefault: false,
  deleteTime: 1756000000000 + index * 86400000
}))

// ─── Deposits / Withdrawals ───────────────────────────────
// transaction/detail 是「參數驅動」的 mock：uid / type / asset / 日期範圍 / 分頁都會真的
// 生效，四個 net amount 也依「篩選後的列」重算，所以 summary 永遠跟畫面上看到的列一致。
//
// 請求端的 type 傳枚舉名，回傳列上的 type 是 DB code（後端 2026-08-12 回覆確認）：
//   EXPRESS_BUY → 49 / EXPRESS_SELL → 80 / DEPOSIT → 1 / WITHDRAW → 2
// 不傳 type → 回全部（後端說 base 會過濾 transaction_type IN (1,2,49,80)）。
const TXN_TYPE_CODE = {
  EXPRESS_BUY: 49,
  EXPRESS_SELL: 80,
  DEPOSIT: 1,
  WITHDRAW: 2
}

// 每個 code 累加到哪一個 net amount 欄位
const NET_AMOUNT_FIELD_BY_CODE = {
  49: 'buyCryptoNetAmount',
  80: 'sellCryptoNetAmount',
  1: 'cryptoDepositNetAmount',
  2: 'cryptoWithdrawalNetAmount'
}

const DAY = 86400000
const daysAgo = (n) => Date.now() - n * DAY

// ⚠️ asset 只用 currencyMap 裡一定有的幣別。DepositsWithdrawals.vue:122-125 是
// `currencyMap?.[value].displayName` —— 只在 currencyMap 本身做了可選存取，沒有對
// 取出來的物件做，所以未知幣別會直接丟 TypeError。
const TXN_ROWS = [
  // uid 8428973355：四種類型都有，跨多個幣別
  { createDateTime: daysAgo(1), shareId: '8428973355', asset: 'USDT', type: 49, netAmount: 1200 },
  { createDateTime: daysAgo(1), shareId: '8428973355', asset: 'USDT', type: 80, netAmount: 450 },
  { createDateTime: daysAgo(2), shareId: '8428973355', asset: 'USDT', type: 1, netAmount: 3000 },
  { createDateTime: daysAgo(2), shareId: '8428973355', asset: 'USDT', type: 2, netAmount: 800 },
  { createDateTime: daysAgo(3), shareId: '8428973355', asset: 'BTC', type: 1, netAmount: 0.15 },
  { createDateTime: daysAgo(3), shareId: '8428973355', asset: 'BTC', type: 2, netAmount: 0.04 },
  { createDateTime: daysAgo(4), shareId: '8428973355', asset: 'ETH', type: 49, netAmount: 2.5 },
  { createDateTime: daysAgo(5), shareId: '8428973355', asset: 'USDT', type: 49, netAmount: 600 },
  { createDateTime: daysAgo(6), shareId: '8428973355', asset: 'USDT', type: 1, netAmount: 1500 },
  { createDateTime: daysAgo(6), shareId: '8428973355', asset: 'USDT', type: 80, netAmount: 220 },
  // 第 11、12 筆讓 pageSize=10 時會有第二頁
  { createDateTime: daysAgo(7), shareId: '8428973355', asset: 'USDT', type: 2, netAmount: 350 },
  { createDateTime: daysAgo(7), shareId: '8428973355', asset: 'ETH', type: 80, netAmount: 1.1 },
  // 刻意放在 30 天前：預設 7 天區間查不到，改成 30 天才會出現，用來驗日期篩選
  { createDateTime: daysAgo(30), shareId: '8428973355', asset: 'USDT', type: 1, netAmount: 9999 },

  // uid 8428973356：資料少，用來驗 uid 篩選真的有作用
  { createDateTime: daysAgo(1), shareId: '8428973356', asset: 'USDT', type: 49, netAmount: 100 },
  { createDateTime: daysAgo(2), shareId: '8428973356', asset: 'USDT', type: 1, netAmount: 250 }
]

const TXN_KNOWN_UIDS = [...new Set(TXN_ROWS.map((row) => row.shareId))]

// 錯誤分支照 api doc B9 / B10 的實測 body。
// 刻意「不」實作 60 天上限：performance/* 有這個限制（B5/B7），但 transaction/detail
// 有沒有還沒得到後端確認，不該把未驗證的行為寫進 mock 當成事實。
const errorBody = (code, msg, data = null) => ({
  code,
  msg,
  time: Date.now(),
  data,
  success: false
})

// ─── Partner List ─────────────────────────────────────────
// 需要有列才點得到 Action → Edit Partner Details（EditCommissionRateDialog）。
//
// isDirectDownstream 決定 Edit 這顆 icon 出不出來：PartnerList.vue:240-242 的
// isDisableEdit 是 `info.uid === accountInfo.uid || !info.isDirectDownstream`，
// 而 PartnerActions.vue:47-51 的 IconEdit2 只看 !isDisableEdit。沒帶這個欄位
// (undefined) 就等於「不是直屬下線」，Edit 會整顆消失、只剩 Details。
// 這個欄位純粹來自後端，FE 沒有任何地方推導它。
//
// 兩列刻意給相反的值，這樣一眼就能看出這道 gate 有在作用，而不是「reviewer 看到
// 一顆 icon 就當成 OK」：第一列該有 Details + Edit，第二列該只有 Details。
// 欄位名已對照 localhost:8081（BTSE 品牌、真實帳號）實際回傳校正過。之前用的
// upperLevelPartnerUid（小寫 i）/ totalUsers / creationTime / activatedTime 都是錯的，
// 會讓 Upline Partner UID、Referred Friends、Lower Level Partners、Creation Time
// 四欄全部空白。正確欄位名見 PartnerList.vue:347-361 的 COLUMN_IDS。
const PARTNER_ROWS = [
  {
    uid: '8100000001',
    nickname: 'Mock Partner A (direct)',
    partnerLevel: 1,
    upperLevelPartnerUId: '8000000000', // 注意大寫 I，真後端就是這樣
    upperLevelPartnerName: 'Channel',
    referredFriends: 12,
    lowLevelPartner: 2,
    isDirectDownstream: true,
    // 費率欄位刻意給值：NexU 應該完全不顯示
    spotRate: 0.18,
    futuresRate: 0.2,
    cwMakerRate: 0.1,
    cwTakerRate: 0.12,
    createTime: 1748000000000,
    note: 'mock partner',
    // falsy → handleClickEdit 走 isInAvailableTime → 直接開 Edit dialog，不會跳
    // NotAvailableEditRateDialog。想測那個擋板就改成未來的 timestamp。
    // （真後端這個欄位可能是 null 或過去的 timestamp，兩者都是 falsy/已過期。）
    availableUpdateTime: null
  },
  {
    uid: '8100000002',
    nickname: 'Mock Partner B (indirect)',
    partnerLevel: 2,
    upperLevelPartnerUId: '8100000001',
    upperLevelPartnerName: 'Mock Partner A (direct)',
    referredFriends: 3,
    lowLevelPartner: 0,
    isDirectDownstream: false,
    spotRate: 0.09,
    futuresRate: 0.1,
    cwMakerRate: 0.05,
    cwTakerRate: 0.06,
    createTime: 1750000000000,
    note: 'mock partner (非直屬，Edit 應該不顯示)',
    availableUpdateTime: null
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

// My Referees 折線圖。
// total 是 string（8081 實測：`{"timestamp":...,"total":"0"}`），periodTotal / gain 也是。
const buildSeries = (base) =>
  Array.from({ length: 10 }, (_, i) => ({
    timestamp: 1756000000000 + i * 86400000,
    total: String(base + i * base * 0.1)
  }))

// gain 是「已經是百分比數值」，給 25 才會顯示成 +25%（對齊 Figma），給 0.25 會變 +0.25%
//
// ⚠️ 刻意「不給」firstTrade —— 真後端對 NexU 就是不回這個欄位（api doc B1 明文確認，
// 實測樣本也只有 registration / firstDeposit）。之前這裡給了 firstTrade，等於 mock 比
// 真後端寬鬆，`Referrals.vue` 那個 `firstTrade.data` 的 TypeError 永遠重現不出來。
//
// 這裡不需要靠「給了資料但畫面沒顯示」來驗證 First Trade 被移除：那條 series 的顯示條件
// 是 isEnableTrade，一個編譯期常數，對 NexU 恆為 false，給不給資料都不可能算繪出來。
// 所以「對齊真後端形狀」比「多給一組用不到的資料」有價值。
//
// ⚠️ 這條 series 只有 data，沒有 periodTotal / gain —— 這是共享行為，8081 實測三條 series
// （registration / firstDeposit / firstTrade）裡只有 registration 帶 periodTotal + gain。
// 之前這裡給了，等於 mock 比真後端寬鬆。
//
// ⚠️ 2026-08-20 改名：firstDeposit → firstExpressBuy（口径同步翻成 type=49）。
// 圖例文案對外叫 "Cash Teller"。staging 實測仍回舊名，後端還在 code review。
const REFERRAL_OVERVIEW = {
  registration: { periodTotal: '7', gain: '25', data: buildSeries(2000) },
  firstExpressBuy: { data: buildSeries(1200) }
}

// ─── Register routes ──────────────────────────────────────
export default function register(app, { defaultApiDomain } = {}) {
  if (!defaultApiDomain) {
    throw new Error('affiliate mock: defaultApiDomain is required')
  }

  if (BYPASS_ALL) {
    // 只留這一支：它是「進得去頁面」的前置條件，不是資料造假
    registerAccountPatch(app, defaultApiDomain)
    console.log(
      `\n🚫 affiliate mock BYPASS_ALL=true —— 只掛 user/account identity patch (${scenario.identity})，` +
        `其餘全部走 proxy 到 ${defaultApiDomain}\n`
    )
    return
  }

  console.log(`\n🎭 affiliate mock SCENARIO = '${SCENARIO}' (referralIdentity=${scenario.identity}, lastStatus=${scenario.formStatus})\n`)

  registerAccountPatch(app, defaultApiDomain)
  registerApplicationStatus(app)

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
        // 真後端（8081 實測）這裡是有值的：Upline Partner filter 的選項來源。
        // 之前給空陣列，等於那個 filter 永遠沒有選項可選、那條路徑測不到。
        parentUidNamePairs: PARTNER_ROWS.map((row) => ({
          uid: row.uid,
          name: row.nickname
        })),
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

  // ─── Deposits / Withdrawals ─────────────────────────────
  app.get('/api/user/referral/transaction/detail', (req, res) => {
    const { uid, type, asset, from, to } = req.query
    const page = Number(req.query.currentPage) || 1
    const size = Number(req.query.pageSize) || 10

    // 錯誤分支（api doc B9 / B10）
    if (!uid) {
      res.locals._mockLabel = 'transaction/detail ✗ 缺 uid → -2'
      return res.status(400).json(errorBody(-2, '[uid: 不能为null]'))
    }
    if (!TXN_KNOWN_UIDS.includes(uid)) {
      res.locals._mockLabel = `transaction/detail ✗ uid=${uid} 越權 → 70018`
      return res.status(400).json(errorBody(70018, 'BADREQUEST: Invalid UID'))
    }
    if (type && TXN_TYPE_CODE[type] === undefined) {
      // 傳了不在枚舉裡的值（例如小寫 'deposit'）→ 枚舉轉換失敗，比照 B3b 的行為
      res.locals._mockLabel = `transaction/detail ✗ type=${type} 非枚舉名 → -2`
      return res.status(400).json(errorBody(-2, 'type'))
    }

    let rows = TXN_ROWS.filter((row) => row.shareId === uid)
    if (from) rows = rows.filter((row) => row.createDateTime >= Number(from))
    if (to) rows = rows.filter((row) => row.createDateTime <= Number(to))
    if (asset) rows = rows.filter((row) => row.asset === asset)
    if (type) rows = rows.filter((row) => row.type === TXN_TYPE_CODE[type])

    // 新到舊，跟真後端的預設排序一致（B8 的樣本是 createDateTime desc）
    rows = [...rows].sort((a, b) => b.createDateTime - a.createDateTime)

    // 四個 net amount 依「篩選後的列」重算，所以選了 Buy 之後只有 buyCryptoNetAmount
    // 會有值，其餘三個是 0 —— summary 跟畫面上的列永遠對得起來。
    const netAmounts = {
      buyCryptoNetAmount: 0,
      sellCryptoNetAmount: 0,
      cryptoDepositNetAmount: 0,
      cryptoWithdrawalNetAmount: 0
    }
    rows.forEach((row) => {
      const field = NET_AMOUNT_FIELD_BY_CODE[row.type]
      if (field) netAmounts[field] += row.netAmount
    })

    const paged = rows.slice((page - 1) * size, page * size)

    res.locals._mockLabel = `transaction/detail uid=${uid} type=${type || 'ALL'} asset=${asset || 'ALL'} → ${rows.length} rows (page ${page}/${Math.ceil(rows.length / size) || 1})`
    res.json(
      envelope({
        ...netAmounts,
        details: {
          totalRows: rows.length,
          pageSize: size,
          currentPage: page,
          totalPages: Math.ceil(rows.length / size),
          data: paged
        }
      })
    )
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
  // ⚠️ 這支回的是「陣列」，不是 userList/dropdowns 那種 {uids, uidNamePairs, ...} 物件。
  // 兩個 caller 都直接 .map()：Performance.vue:331 和 PartnerList.vue:537。回錯 shape 的話
  // .map is not a function → 被 catch 吃掉 → partnerOptions 停在 []，Performance 左上角的
  // partner 下拉和 LevelInfo（Upline Partner / Level）會整排空白，而且畫面上看不出原因。
  //
  // 每個 option 需要的欄位：
  //   uid / partnerName          → 下拉顯示文字（uid === 登入者時會被換成 t('t.you')）
  //   partnerLevel               → LevelInfo.vue:21 判斷是 Channel(0) 還是 Level N
  //   upperLevel:{uid,partnerName} → LevelInfo.vue:8-12 的 Upline Partner 那一格
  //
  // 第一筆的 uid 一定要等於登入帳號的 uid，否則 setInitialPartner()（Performance.vue:323-326）
  // 找不到對應 option，會 fallback 成 {}，一樣整排空白。
  // 8081 實測補正：root（自己）的 upperLevel 是 null，不是一個假的上層物件；
  // 有上層的那幾筆，upperLevel 內含 partnerLevel。
  app.get('/api/user/referral/partner/dropdowns', (req, res) => {
    const options = [
      {
        uid: LOGIN_UID,
        partnerName: 'Mock Channel',
        partnerLevel: 1,
        upperLevel: null
      },
      ...PARTNER_ROWS.map((row) => ({
        uid: row.uid,
        partnerName: row.nickname,
        partnerLevel: 2,
        upperLevel: {
          uid: LOGIN_UID,
          partnerName: 'Mock Channel',
          partnerLevel: 1
        }
      }))
    ]
    res.locals._mockLabel = `partner/dropdowns (${options.length} options, array shape)`
    res.json(envelope(options))
  })
  app.get('/api/user/referral/partner', (req, res) => {
    res.locals._mockLabel = `partner (${PARTNER_ROWS.length} rows)`
    res.json(paginated(PARTNER_ROWS))
  })

  // ─── Accessible functions ───────────────────────────────
  // 沒有這個，Affiliate 側邊欄不會出現 Performance / Deposits & Withdrawals tab
  // （Affiliate.vue 的 hide 條件看 accessibleFunctions）。
  // 開關在檔案上方的 MOCK_FUNCTION_LIST。
  app.get('/api/function/list', (req, res, next) => {
    if (!MOCK_FUNCTION_LIST) return next()

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
  // 這兩支已對齊後端 api doc（nexu接口-case设计稿.md 的 B4 / B6，2026-08-11 實跑樣本）。
  // 之前是憑猜測寫的欄位名（partnerUid / partnerNickname / commission 嵌套物件），跟真後端
  // 和 FE 都對不上，所以表格整排空白 —— 不是 code 壞掉，是 mock 對不上。
  //
  // NexU 的 summary 是「扁平 6 欄」，不是共享版的 {commission:{total,direct,indirect}} 嵌套。
  // 舊的 commission / tradingFee / tradingVolume / netDeposit 一律不再回傳，因為真後端
  // 對 nexu 就是不回 —— 留著假資料會讓「欄位藏起來了」變成無意義的驗證。
  const PERFORMANCE_SUMMARY = {
    // PRD 的兩張卡：headline = net，左右子項 = 各自的組成
    netCryptoPurchases: 830, // = buyCrypto - sellCrypto
    buyCrypto: 1920,
    sellCrypto: 1090,
    netCryptoInflows: 5350, // = cryptoDeposits - cryptoWithdrawals
    cryptoDeposits: 7200,
    cryptoWithdrawals: 1850,
    // loginUserLevel / rootUserLevel 餵 SelectedSummary.vue:102,108 的 accountUser /
    // selectedPartnerInfo。doc 的 seed 兩個都是 0（root 就是 channel），這裡給 0/1 讓
    // LevelInfo 顯示 "Level 1" 而不是 "Channel"，跟 Figma 9378-7183 的畫面一致。
    loginUserLevel: 0,
    rootUserLevel: 1,
    dataUpdatedTime: Date.now() - 12 * 60 * 60 * 1000,
    referralCode: 'NEXUSEEDP2'
    // ⚠️ 刻意不給 availableUpdateCommissionTime / availableUpdateSelfRebateTime /
    // commissionCreationTime。8081（BTSE 共享版）有回這三個，所以之前這裡照著給了；
    // 但 2026-08-20 實測 staging 的 nexu summary 只回上面那 10 個欄位，沒有這三個。
    // 給了就是 mock 比真後端寬鬆 —— nexu 讀不到的東西不該在這裡有值。
  }

  app.get('/api/user/referral/performance/summary', (req, res) => {
    res.locals._mockLabel = `performance/summary (flat 6 fields, parentUid=${req.query?.parentUid})`
    res.json(envelope(PERFORMANCE_SUMMARY))
  })

  // 欄位名照 doc B6：uid / name / parentUid / parentName / level / role +
  // buyCrypto / sellCrypto / cryptoDeposits / cryptoWithdrawals。
  // FE 的 COLUMN_IDS（performance/const.js）與 PerformanceTable.vue:227-229 讀的就是這些。
  //
  // ⚠️ role 的 enum 要用 'premium' / 'basic'（REFERRAL_USER_TYPES），不是 userList 那組
  // 'PARTNER' / 'DIRECT_USER'（REFERRAL_ROLE）。PerformanceTable.vue:218-225 是
  // `value === REFERRAL_USER_TYPES.PREMIUM ? Partner : User`，所以除了 'premium' 以外的
  // 任何值都會顯示 User。doc B6 的樣本三列都是 'basic'（seed 沒有 partner 下線），
  // 所以「哪個值代表 Partner」目前是推論的，值得跟後端確認。
  const PERFORMANCE_ROWS = [
    {
      uid: 'NXU8419937077',
      name: 'Mock Downline C',
      parentUid: LOGIN_UID,
      parentName: 'Mock Channel',
      level: 3,
      role: 'basic',
      buyCrypto: 500,
      sellCrypto: 300,
      cryptoDeposits: 900,
      cryptoWithdrawals: 350
    },
    {
      uid: 'NXU8419937012',
      name: 'Mock Downline A',
      parentUid: LOGIN_UID,
      parentName: 'Mock Channel',
      level: 2,
      role: 'premium', // → Role Status 顯示 "Partner"
      buyCrypto: 300,
      sellCrypto: 150,
      cryptoDeposits: 800,
      cryptoWithdrawals: 200
    },
    {
      // name 給 null：Figma 的表格有幾列 Name 是 "-"，這列用來驗那個 fallback
      uid: 'NXU8419937052',
      name: null,
      parentUid: LOGIN_UID,
      parentName: 'Mock Channel',
      level: 2,
      role: 'basic',
      buyCrypto: 120,
      sellCrypto: 40,
      cryptoDeposits: 500,
      cryptoWithdrawals: 100
    }
  ]

  app.get('/api/user/referral/performance/details', (req, res) => {
    res.locals._mockLabel = `performance/details (${PERFORMANCE_ROWS.length} rows, orderBy=${req.query?.orderBy || 'default'})`
    res.json(paginated(PERFORMANCE_ROWS))
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
  // 形狀照 8081 實測，不是憑空給的空物件 —— 萬一 nexu 真的呼叫到了，形狀對才會「空空地
  // 算繪」而不是丟 TypeError，這樣回歸訊號才讀得出來是「元件回來了」而不是「mock 壞了」。
  app.get('/api/user/referral/commissionOverview', (req, res) => {
    res.locals._mockLabel = '⚠️ commissionOverview 被呼叫（NexU 應該不顯示 My Earnings）'
    const empty = {
      data: [],
      currency: 'USDT',
      periodTotal: '0',
      previousPeriodTotal: '0',
      gain: '0'
    }
    res.json(envelope({ direct: empty, indirect: empty, total: empty }))
  })
  app.get('/api/user/referral/totalCommission', (req, res) => {
    res.locals._mockLabel = '⚠️ totalCommission 被呼叫（NexU 應該不顯示 Leaderboard）'
    res.json(envelope({ currency: 'USDT', data: [] }))
  })
}
