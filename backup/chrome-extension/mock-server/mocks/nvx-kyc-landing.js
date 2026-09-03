// Mock for BTSE ID(nvx) 的 KYC 落地導轉 / 2FA 提醒 —— PLAT-38019。
// 改這個檔案 → hot reload 自動生效（改 SCENARIO 不用重啟 mock server）。
//
// ─── 為什麼需要這支 ─────────────────────────────────────────
// PRD（[BTSE ID][Web] KYC/2FA Reminder & Page Routing Consolidation）把登入落地、
// 2FA 提醒、首頁按鈕三件事全部綁在「使用者的 KYC 狀態」上，共四個狀態：
//
//   | KYC 狀態   | 登入落地 | 2FA 提醒框 | 首頁按鈕            |
//   |------------|---------|-----------|---------------------|
//   | Unverified | 驗證頁   | 不跳       | 驗證頁 / Get Started |
//   | On Review  | 前一頁   | 跳         | 驗證頁 / Get Started |
//   | Rejected   | 驗證頁   | 不跳       | 驗證頁 / Get Started |
//   | Approved   | 前一頁   | 跳         | 交易頁 / Trade Now   |
//
// 而測試帳號只能停在其中一個狀態（而且 Rejected 要 CS 從 Admin reset 才回得去，
// 見 PRD 6 的 operational dependency）。要一個一個真的跑完 KYC 不現實，所以這裡
// 只改 kyc/status 的兩個欄位來切換狀態。
//
// ─── 只改兩個欄位（走 tamper 而不是整包 respond）───────────────
// kyc/status 的回傳除了 level / levelStatus 之外還有 enableVerification、
// draftOfKycForm、latestKycFlow、rejectionLabel、riskProfileVerification 等等,
// 落地到驗證頁之後那一頁到處在讀。整包假造會讓「驗證頁自己壞掉」跟「導轉邏輯壞掉」
// 分不出來，所以 proxy 真後端、只覆寫 level 與對應那一層的 status。
//
// ─── 資料模型（這支 mock 的全部依據）─────────────────────────
// `level` 是**使用者現在持有的等級**，送審**不會**讓它前進。
// 變的是 `levelStatus[level].status`：
//
//   APPROVED(3) 只過了 email 驗證, KYC 還沒開始   ← BTSE ID 把 email 算成 LN 的一步
//        ↓ 送出 L1
//   PROGRESS(2) 審核中
//        ↓
//   APPROVED(3) 通過 → level 前進到 1     或     REJECTED(4) 待補交
//
// 前端的 useKycStore 因此有 currentKycStatus = kycStatusMap[currentKycLevel]，
// 也就是「使用者現在這一關的即時狀態」。這支 mock 就是照這個模型造資料的 ——
// **如果實測發現前端行為跟下面的預期表不符，先懷疑這個模型而不是前端。**
//
// ─── 刻意偏離真實的地方 ─────────────────────────────────────
// approvedL1 / approvedL1WithL2OnReview 會把 level 從 0 改成 1，但
// user/account 的 kycV2Level 還是真後端的 'LNNVX'（前端只拿它做 mixpanel 標記，
// 見 useKycStore 的 currentKycLevelName）。所以那兩個情境下**不要拿驗證頁的畫面
// 當真** —— 那一頁會混著「假的 level 1」和「真的 LN」。反正那兩個情境的預期行為
// 就是不會落地到驗證頁。
import { tamper, asJson } from './_helpers.js'

// ─── 後端的 KYC 狀態 enum（對齊前端的 src/const.js KYC_STATUS）─────
// 名稱是後端定義的，數字與前端 KYC_STATUS 對得上
const WAIT_VERIFY = 1 // 尚未驗證 → 前端 ADMIN_IN_PROGRESS
const IN_PROGRESS = 2 // 驗證中   → 前端 PROGRESS
const VERIFIED = 3 // 驗證成功 → 前端 APPROVED
const REJECTED = 4 // 待補交   → 前端 REJECTED

// ─── 情境開關（最常要動的就是這個）─────────────────────────
// 改這個值 → hot reload 生效，重新登入就會看到對應行為。
//
//   'off'                      不動 kyc/status，看真後端的實際狀態
//   'unverified'               沒開始做 KYC（測試帳號的真實狀態，等於 off + 保險）
//   'onReview'                 L1 送出、等審核        ← 最該驗的一個
//   'rejected'                 L1 被退、要補交
//   'approvedL1'               L1 通過，可以交易
//   'approvedL1WithL2OnReview' L1 通過後又送 L2，審核中
const SCENARIO = 'off'

/*
  每個情境要覆寫什麼。
    level        使用者現在持有的等級（送審不會讓它前進）
    statusByLevel  要覆寫哪幾層的 status（沒列到的層沿用真後端的值）

  ⚠️ statusByLevel 的 key 是 KYC level，不是陣列 index —— 真後端的 levelStatus
  是 [{level, status}, ...]，順序不保證，所以照 level 對，不照位置對。
*/
const SCENARIOS = {
  unverified: { level: 0, statusByLevel: { 0: VERIFIED } },
  onReview: { level: 0, statusByLevel: { 0: IN_PROGRESS } },
  rejected: { level: 0, statusByLevel: { 0: REJECTED } },
  approvedL1: { level: 1, statusByLevel: { 0: VERIFIED, 1: VERIFIED } },
  approvedL1WithL2OnReview: {
    level: 1,
    statusByLevel: { 0: VERIFIED, 1: IN_PROGRESS, 2: WAIT_VERIFY }
  }
}

/*
  強制覆寫 user/account 的 isGoogleBind（2FA 有沒有綁）。
    null   不動，用真後端的值（平時放 null）
    false  假裝沒綁 → KYC 過關的情境才看得到 2FA 提醒框
    true   假裝綁了 → 驗 landingActions 的 is2FaBinded 早退

  ⚠️ 這只騙前端的顯示判斷，帳號實際上還是綁著的 —— 所以框裡的 "Set up" 按下去
  之後的頁面會跟預期不同。只用來驗「框該不該出現」。
*/
const FORCE_IS_GOOGLE_BIND = null

export default function register(app, { defaultApiDomain }) {
  if (SCENARIO !== 'off') {
    const scenario = SCENARIOS[SCENARIO]
    if (!scenario) {
      throw new Error(
        `nvx-kyc-landing: 不認識的 SCENARIO '${SCENARIO}'，可選：${Object.keys(
          SCENARIOS
        ).join(' / ')} / off`
      )
    }

    app.use(
      '/api/kyc/status',
      tamper(defaultApiDomain, {
        label: `kyc/status → ${SCENARIO}`,
        modify: asJson(body => {
          const data = body?.data
          if (!data) return // 真後端回錯誤（未登入之類）→ 原樣放行

          data.level = scenario.level

          if (Array.isArray(data.levelStatus)) {
            for (const item of data.levelStatus) {
              const next = scenario.statusByLevel[item.level]
              if (next !== undefined) item.status = next
            }
          }
        })
      })
    )
  }

  if (FORCE_IS_GOOGLE_BIND !== null) {
    app.use(
      '/api/user/account',
      tamper(defaultApiDomain, {
        label: `user/account → isGoogleBind: ${FORCE_IS_GOOGLE_BIND}`,
        modify: asJson(body => {
          if (body?.data) body.data.isGoogleBind = FORCE_IS_GOOGLE_BIND
        })
      })
    )
  }
}
