import path from 'path'
import select from '@inquirer/select'

import { checkSetting, consolePathHint, consoleRed, consoleStep, consoleYellow, high, readSetting } from '../utils.js'
import { resolveBrand } from '../brand-utils.js'
import { fullSyncFromFigma } from '../full-sync-utils.js'
import { STATUS } from './fetch-assets.js'
import { askFigmaUrl, readFigmaToken, runInteractiveFetch } from './pull-from-figma.js'

/**
 * 從 Figma 網址一路做到 frontend / s3 repo。
 *
 * 就是「從 Figma 抓圖」+「一次同步」串起來, 兩個指令本身都留著:
 *   - 抓圖那段出問題 → 用人工 export 到 figma-images, 再跑「一次同步」
 *   - 同步那段出問題 → 用「從 Figma 抓圖」把圖抓好, 再自己處理
 */
export async function pullAndSyncFromFigma() {
  const settings = readSetting()
  if (settings == null) return

  // 兩段需要的 setting 一次驗完, 不要抓完圖才發現 s3-repo-path 沒設
  const {
    ok,
    frontendRepoPath,
    s3RepoPath,
    figmaImagesFolders,
    targetBrand: settingBrand,
  } = checkSetting(settings, [
    'frontend-repo-path',
    's3-repo-path',
    'new-images-folder',
    'figma-images-folders',
    'target-brand',
  ])
  if (!ok) return

  const token = readFigmaToken(settings)
  if (token == null) return
  consoleStep('setting')

  // 要問的全部問在前面, 後面的長工才不會跑到一半又跳出問題
  const targetBrand = await resolveBrand({ settingBrand, frontendRepoPath, s3RepoPath })
  if (targetBrand == null) return
  consoleStep(`target-brand = ${high(targetBrand)}`)

  const url = await askFigmaUrl()
  if (url == null) return void consoleRed('使用者取消')

  consolePathHint({
    sourceLines: [high('Figma (REST API)')],
    targetLines: [
      `${high(path.resolve('.', figmaImagesFolders))} (抓下來的來源檔案)`,
      high(path.resolve(frontendRepoPath, 'src', `brand-${targetBrand}`)),
      high(path.resolve(s3RepoPath, targetBrand)),
    ],
  })
  console.log('這個指令會一次做完「從 Figma 抓圖」和「同步到 frontend / s3 repo」,')
  console.log('中間會有兩次確認: 一次是寫入 figma-images, 一次是覆蓋 repo。')
  console.log()

  console.log(`${high('[1/2]')} 從 Figma 抓圖`)
  console.log()
  const pulled = await runInteractiveFetch({
    figmaToken: token,
    outputDir: figmaImagesFolders,
    figmaUrl: url,
  })
  if (pulled == null || pulled.written.length === 0) {
    return void consoleRed('抓圖階段沒有完成, 不會往下同步')
  }

  if (pulled.status !== STATUS.SUCCESS) {
    console.log()
    consoleYellow('⚠️  抓圖階段沒有全部成功, 表示有資產被跳過 (檔案沒抓到或沒通過檢查)。')
    consoleYellow('   往下同步的話, 缺的那些會在同步階段的來源檔案檢查被擋下來。')
    const goOn = await select({
      message: '還要往下跑同步嗎?',
      choices: [
        { name: '先停在這裡, 我去確認一下', value: false },
        { name: '繼續, 讓同步階段自己擋', value: true },
      ],
    }).catch(() => false)
    if (!goOn) return void consoleRed('停在抓圖階段, figma-images 裡的檔案留著')
  }

  console.log()
  console.log(`${high('[2/2]')} 同步到 frontend / s3 repo`)
  console.log()
  await fullSyncFromFigma({ targetBrand })
}
