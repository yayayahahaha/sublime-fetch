// Mock responses for futures assessment-test flow.
// 改這個檔案 → 重啟 server 即可 reload。所有「使用者進度」都是 module state，
// 重啟自動歸零（attemptsRemaining / 計分 / lock / quiz deadline 全部 reset）。
import express from 'express'

const jsonParser = express.json()

// ─── helpers ──────────────────────────────────────────────
const envelope = (data) => ({
  returnCode: 1,
  result: 'SUCCESS',
  data,
})

const errorEnvelope = (code, status = 400) => ({
  _httpStatus: status, // 給 server 看的 metadata，不會送到 client
  body: {
    returnCode: 0,
    result: 'FAIL',
    code,
    data: null,
  },
})

// ─── 設定常數（要改就動這幾個）─────────────────────────────
const TOTAL_QUESTIONS = 5
const PASS_THRESHOLD = 0.6 // 0 ~ 1；5 題就是答對 ≥ 3 才 pass
const ATTEMPTS_ALLOWED = 3 // 每 tier 最多失敗幾次後被 LOCK
const ATTEMPT_WINDOW_HOURS = 24
const TIME_LIMIT_SECONDS = 20 // 每輪 quiz 從第一次 GET /quiz 開始倒數
const LOCKED_SECONDS = 3600 // LOCK 後給的 lockedRemainingSeconds（前端 LockDialog 自己倒數）
const INITIAL_TIER = 2 // 想直接從 F2 開始測就改成 2
const F1_TO_F2_UNLOCK_SECONDS = 30 // F1 PASSED 後等多久自動解鎖 F2（真實環境是 30 天）
const CURRENT_EXAM = 'future_1'

const minCorrectToPass = Math.ceil(PASS_THRESHOLD * TOTAL_QUESTIONS)

// 每題的正確答案（0-based index），跟原始（未打亂前）的 options 陣列對應。
// 使用者送來的 answer[0] 和這個值一樣就算答對；不一樣算答錯。
// （前端會 shuffle options 後再 mapping 回原 index，所以這裡只看原 index。）
const correctAnswerByQuizNumber = {
  1: 0,
  2: 0,
  3: 0,
  4: 0,
  5: 0,
}

// ─── Mutable state（重啟 server 全部歸零）─────────────────
let currentTier = INITIAL_TIER
let userStatus = 'INIT' // INIT | PROCESSING | PASSED | LOCK
let attemptsRemaining = ATTEMPTS_ALLOWED
let lockedRemainingSeconds = null // 只有 LOCK 時非 null
let currentQuizNumber = 1
let correctCount = 0
let quizDeadline = null // ms epoch；首次 GET /quiz 設定，最終題 / abandon 後清空
let f1PassedAt = null // ms epoch；F1 PASSED 的時間點，過了 F1_TO_F2_UNLOCK_SECONDS 就升級

function resetQuizSession() {
  currentQuizNumber = 1
  correctCount = 0
  quizDeadline = null
}

// F1 已通過、等待 F2 解鎖中、且已過設定的延遲時間 → 升級到 tier 2 INIT
// 每次回應 status 之前都呼叫一下，無條件 idempotent
function maybePromoteToTier2() {
  if (
    currentTier !== 1 ||
    userStatus !== 'PASSED' ||
    f1PassedAt === null ||
    Date.now() < f1PassedAt + F1_TO_F2_UNLOCK_SECONDS * 1000
  ) {
    return
  }
  currentTier = 2
  userStatus = 'INIT'
  attemptsRemaining = ATTEMPTS_ALLOWED
  lockedRemainingSeconds = null
  f1PassedAt = null
  resetQuizSession()
}

function getRemainingSeconds() {
  if (quizDeadline === null) return TIME_LIMIT_SECONDS
  return Math.max(0, Math.ceil((quizDeadline - Date.now()) / 1000))
}

// 上一輪 quiz 超時但客戶端還沒消化 EXPIRED → 在這次 status 把它當失敗結帳:
// 扣一次 attempt、重置 session；扣到 0 變 LOCK，否則回 INIT 讓前端拿到新一輪
// 的 start dialog 資訊。每次 statusHandler 開頭呼叫一次即可，idempotent。
function maybeConsumeExpiredAttempt() {
  if (quizDeadline === null || Date.now() <= quizDeadline) return
  attemptsRemaining = Math.max(0, attemptsRemaining - 1)
  if (attemptsRemaining === 0) {
    userStatus = 'LOCK'
    lockedRemainingSeconds = LOCKED_SECONDS
  } else {
    userStatus = 'INIT'
  }
  resetQuizSession()
}

// ─── GET /assessment/trading/status（動態）─────────────────
// 回應隨 attemptsRemaining / userStatus 動態變化。LOCK 也是這裡判斷。
const statusHandler = (req, res) => {
  // 先看 F1 PASSED 是不是已經等夠久該升級
  maybePromoteToTier2()
  // 再看上一輪 quiz 是不是超時了沒結帳
  maybeConsumeExpiredAttempt()
  const isLocked = userStatus === 'LOCK'
  const maxLeverage = currentTier === 2 ? 50 : 20
  const payload = {
    status: userStatus,
    tierLevel: currentTier,
    attemptWindowHours: ATTEMPT_WINDOW_HOURS,
    attemptsAllowed: ATTEMPTS_ALLOWED,
    attemptsRemaining,
    timeLimit: isLocked ? null : TIME_LIMIT_SECONDS,
    lockedRemainingSeconds: isLocked ? lockedRemainingSeconds : null,
    passThreshold: PASS_THRESHOLD,
    maxLeverage,
  }
  res.locals._mockLabel = `status ${userStatus} tier=${currentTier} attempts=${attemptsRemaining}/${ATTEMPTS_ALLOWED}`
  res.json(envelope(payload))
}

// 想強制套用某個固定 status（例如 NOT_SUPPORT），把 register 裡的 statusHandler
// 換成 respond('status notSupport', statusVariants.notSupport) 就好。
// 預設不會用到，留在這當參考。
export const statusVariants = {
  notSupport: envelope({
    status: 'NOT_SUPPORT',
    tierLevel: 1,
    attemptWindowHours: null,
    attemptsAllowed: null,
    attemptsRemaining: null,
    timeLimit: null,
    lockedRemainingSeconds: null,
    passThreshold: null,
    maxLeverage: null,
  }),
}

// ─── GET /assessment/trading/quiz ────────────────────────
// 第一次呼叫設定 deadline，之後回傳 (deadline - now)。
// 超時直接回 ASSESSMENT_QUIZ_EXPIRED，前端 Quiz dialog 會切到 TIME_EXPIRED。
const buildQuizQuestion = (qNum) => ({
  quizId: `mock-q${qNum}`,
  quizSection: 5,
  content: {
    description: `[Q${qNum}/${TOTAL_QUESTIONS}] API keys with trading permissions should be:`,
    note: null,
    explanation: null,
    options: [{
      description: 'Shared with trusted trading groups for efficiency'
    }, {
      description: 'Kept strictly private, IP-whitelisted, and given only the minimum permissions required',
    }, {
      description: 'Posted in public repositories for transparency'
    }, {
      description: 'Regenerated only once per year'
    }, ],
  },
})

const quizHandler = (req, res) => {
  // 第一次拿題目 → 設 deadline，並把使用者狀態推到 PROCESSING
  if (quizDeadline === null) {
    quizDeadline = Date.now() + TIME_LIMIT_SECONDS * 1000
  }
  if (userStatus === 'INIT') {
    userStatus = 'PROCESSING'
  }

  const remainingTime = getRemainingSeconds()
  if (remainingTime === 0) {
    res.locals._mockLabel = `quiz Q${currentQuizNumber} EXPIRED`
    return res.status(quizExpiredError._httpStatus).json(quizExpiredError.body)
  }

  res.locals._mockLabel = `quiz Q${currentQuizNumber}/${TOTAL_QUESTIONS} (${remainingTime}s left)`
  res.json(
    envelope({
      currentExam: CURRENT_EXAM,
      totalAmount: TOTAL_QUESTIONS,
      remainingTime,
      quizNumber: currentQuizNumber,
      quizzes: [buildQuizQuestion(currentQuizNumber)],
    })
  )
}

// ─── POST /assessment/trading/quiz/answer ────────────────
// 答題：
//   - 比對 answer[0] 是否等於 correctAnswerByQuizNumber[quizNumber] → 算對／錯
//   - 最後一題（Q == TOTAL_QUESTIONS）依累計 correctCount 決定 passed
//   - PASSED → userStatus 變 PASSED（attempts 不扣，前端 isF1Pass / isCompleted 接手）
//   - FAILED → attemptsRemaining--，扣到 0 → userStatus 變 LOCK
//   - 任何最終結果都會清掉 quiz session（題數歸零、deadline 清空）
const answerHandler = (req, res) => {
  // 已過期 → 直接 expired
  if (quizDeadline !== null && Date.now() > quizDeadline) {
    res.locals._mockLabel = `answer EXPIRED (past deadline)`
    return res.status(quizExpiredError._httpStatus).json(quizExpiredError.body)
  }

  const quizNumber = req.body?.quizNumber ?? 1
  const submittedAnswer = req.body?.answer?.[0]
  const correctAnswer = correctAnswerByQuizNumber[quizNumber] ?? 0
  const isCorrect = submittedAnswer === correctAnswer
  const isFinalQuiz = quizNumber >= TOTAL_QUESTIONS

  if (isCorrect) correctCount++

  let passed = null
  let finalCorrectCount = null
  let finalTotalAmount = null
  let finalNote = `→ next Q${quizNumber + 1}`

  if (isFinalQuiz) {
    finalCorrectCount = correctCount
    finalTotalAmount = TOTAL_QUESTIONS
    passed = correctCount >= minCorrectToPass

    if (passed) {
      userStatus = 'PASSED'
      // tier 1 通過 → 記時間，statusHandler 之後會看時間決定要不要升級到 tier 2
      if (currentTier === 1) {
        f1PassedAt = Date.now()
      }
      finalNote = `[PASSED ${finalCorrectCount}/${finalTotalAmount}, userStatus=PASSED${
        currentTier === 1 ? `, F2 unlock in ${F1_TO_F2_UNLOCK_SECONDS}s` : ''
      }]`
    } else {
      attemptsRemaining = Math.max(0, attemptsRemaining - 1)
      if (attemptsRemaining === 0) {
        userStatus = 'LOCK'
        lockedRemainingSeconds = LOCKED_SECONDS
        finalNote = `[FAILED ${finalCorrectCount}/${finalTotalAmount}, attempts=0 → LOCK ${LOCKED_SECONDS}s]`
      } else {
        userStatus = 'INIT'
        finalNote = `[FAILED ${finalCorrectCount}/${finalTotalAmount}, ${attemptsRemaining}/${ATTEMPTS_ALLOWED} attempt(s) left]`
      }
    }
  }

  // log label 用 mutate 前的 quizNumber + tally
  const tag = isCorrect ? '✓' : '✗'
  const tally = `tally ${correctCount}/${TOTAL_QUESTIONS}`
  res.locals._mockLabel = `answer Q${quizNumber} ${tag} ${tally} ${finalNote}`

  // 推進 / reset session
  if (isFinalQuiz) {
    resetQuizSession()
  } else {
    currentQuizNumber = quizNumber + 1
  }

  res.json(
    envelope({
      correct: isCorrect,
      answer: correctAnswer,
      isFinalQuiz,
      passed,
      correctCount: finalCorrectCount,
      totalAmount: finalTotalAmount,
    })
  )
}

// ─── DELETE /assessment/trading/quiz ──────────────────────
// 使用者放棄當前考試。實務上等同失敗：扣一次 attempt，扣到 0 也會 LOCK。
const abandonHandler = (req, res) => {
  resetQuizSession()
  attemptsRemaining = Math.max(0, attemptsRemaining - 1)

  let note
  if (attemptsRemaining === 0) {
    userStatus = 'LOCK'
    lockedRemainingSeconds = LOCKED_SECONDS
    note = `attempts=0 → LOCK ${LOCKED_SECONDS}s`
  } else {
    userStatus = 'INIT'
    note = `${attemptsRemaining}/${ATTEMPTS_ALLOWED} attempt(s) left`
  }
  res.locals._mockLabel = `abandon (counted as failure, ${note})`
  res.json(envelope(null))
}

// ─── Error 場景（給 status / quiz / answer 用都行）─────────
export const quizExpiredError = errorEnvelope('ASSESSMENT_QUIZ_EXPIRED')
export const lockedOutError = errorEnvelope('ASSESSMENT_LOCKED_OUT')
export const generalError = errorEnvelope('ASSESSMENT_NOT_ELIGIBLE')

// ─── Register routes ──────────────────────────────────────
// 預設 status 是動態 handler，會跟著 attempts / userStatus 變。
// 想強制套用某個固定 variant（例如 NOT_SUPPORT），import 共用的 respond helper
// 然後改成：
//   import { respond } from './_helpers.js'
//   app.get('...status', respond('status notSupport', statusVariants.notSupport))
export default function register(app) {
  app.get('/futures/api/trading/assignedMaxLeverage', (_, res) => {
    const assignedMaxLeverage = 10
    res.locals._mockLabel = `assignedMaxLeverage: ${assignedMaxLeverage}`

    res.json({
      code: 1,
      msg: "Success",
      time: Date.now(),
      data: { assignedMaxLeverage },
      success: true
    })
  })

  app.get('/futures/api/assessment/trading/status', statusHandler)
  app.get('/futures/api/assessment/trading/quiz', quizHandler)
  app.post(
    '/futures/api/assessment/trading/quiz/answer',
    jsonParser,
    answerHandler
  )
  app.delete('/futures/api/assessment/trading/quiz', abandonHandler)
}