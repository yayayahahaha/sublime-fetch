// 把 SOURCE 整份（含隱藏檔、巢狀目錄）複製進 TARGET，但跳過 EXCLUDE_NAMES 列出的
// 資料夾/檔案名稱（不論在 source 底下哪一層，例如 node_modules、.git）。
// 預設 dry-run（只印計畫、不動檔案），確認清單沒問題後加 --yes 才會真的執行：
//   node sync-me.mjs
//   node sync-me.mjs --yes

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// ⚠️ 用之前先把下面兩個換成真的路徑，還是 placeholder 會直接拒絕執行
const SOURCE = '/Users/flyc.chung/btse/chrome-extension'
const TARGET = '/Users/flyc.chung/flyc/sublime-fetch/backup/chrome-extension'

// 這些名字的資料夾/檔案不會被複製到 target，不論在 source 底下哪一層
const EXCLUDE_NAMES = ['node_modules', '.git']

const EXECUTE = process.argv.includes('--yes')

function resolveRequiredPath(label, value) {
  if (!value || value.startsWith('MOCK_')) {
    console.error(`✗ ${label} 還是 placeholder（${value}），先改成真的路徑再跑`)
    process.exit(1)
  }
  return path.resolve(value)
}

// 擋掉明顯危險的 target：根目錄、home 目錄，或跟 source 有包含關係（其中一個是另一個的子目錄）
function assertSafeTarget(sourceAbs, targetAbs) {
  const home = path.resolve(os.homedir())
  if (targetAbs === path.resolve('/') || targetAbs === home) {
    throw new Error(`target (${targetAbs}) 是根目錄或 home 目錄，拒絕執行`)
  }
  if (targetAbs === sourceAbs) {
    throw new Error('target 跟 source 是同一個路徑，拒絕執行')
  }
  if (
    targetAbs.startsWith(sourceAbs + path.sep) ||
    sourceAbs.startsWith(targetAbs + path.sep)
  ) {
    throw new Error('target 跟 source 有包含關係（其中一個是另一個的子目錄），拒絕執行')
  }
}

function isExcluded(entryPath) {
  return EXCLUDE_NAMES.includes(path.basename(entryPath))
}

// 純粹給 dry-run 預覽用：掃一遍 source，列出會被跳過的項目（邏輯跟下面 cpSync 的 filter 一致）
function collectExcludedPreview(sourceAbs) {
  const found = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (isExcluded(full)) {
        found.push(full)
        continue // 排除的資料夾不用往下探
      }
      if (entry.isDirectory()) walk(full)
    }
  }
  walk(sourceAbs)
  return found
}

function main() {
  const sourceAbs = resolveRequiredPath('source', SOURCE)
  const targetAbs = resolveRequiredPath('target', TARGET)

  assertSafeTarget(sourceAbs, targetAbs)

  if (!fs.existsSync(sourceAbs) || !fs.statSync(sourceAbs).isDirectory()) {
    throw new Error(`source 不存在或不是資料夾: ${sourceAbs}`)
  }

  const targetExists = fs.existsSync(targetAbs)
  const excluded = collectExcludedPreview(sourceAbs)

  console.log(`source: ${sourceAbs}`)
  console.log(`target: ${targetAbs}${targetExists ? '' : '（目前不存在，會建立）'}`)
  console.log()
  console.log('會把 source 整份（含隱藏檔、巢狀目錄）複製進 target（force：會覆蓋同名檔案）')
  console.log(`不會複製以下項目（名稱符合 EXCLUDE_NAMES: ${EXCLUDE_NAMES.join(', ')}）：`)
  if (excluded.length === 0) {
    console.log('  （source 裡沒有符合的項目）')
  } else {
    for (const p of excluded) console.log(`  - ${p}`)
  }

  if (!EXECUTE) {
    console.log()
    console.log('這是 dry-run，還沒有動任何檔案。確認上面的清單沒問題後，加 --yes 再跑一次：')
    console.log('  node sync-me.mjs --yes')
    return
  }

  console.log()
  console.log('--yes 已指定，開始執行...')

  fs.mkdirSync(targetAbs, { recursive: true })
  fs.cpSync(sourceAbs, targetAbs, {
    recursive: true,
    force: true,
    dereference: true,
    filter: (src) => !isExcluded(src),
  })
  console.log(`已將 ${sourceAbs} 複製到 ${targetAbs}（已跳過 ${EXCLUDE_NAMES.join(', ')}）`)
}

main()
