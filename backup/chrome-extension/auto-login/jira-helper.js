import { input } from '@inquirer/prompts'
import { blue, lightGreen, red, lightCyan } from '../color.js'
import { exec } from 'child_process'

export async function jiraBranchHelper() {
  const title = await input({ 
    message: '請輸入 Jira 頁面標題 (例如: [PROD-123] Fix something - Jira):',
    validate: (val) => !!val.trim() || '標題不能為空'
  })

  const match = title.match(/^\[(\w+-\d+)\]\s*(.+)\s*-\s*Jira$/)
  
  if (!match) {
    console.log(red('\n❌ 格式解析失敗！'))
    console.log('預期格式: [JIRA-XXX] 描述 - Jira')
    return
  }

  const [, jiraNum, rest] = match
  const description = rest
    .trim()
    .replace(/[^\w\u4e00-\u9fff]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  const userNameInput = await input({ message: '請輸入你的名字 (用於 branch prefix):', default: 'user' })
  const branchName = `${userNameInput}/${jiraNum}_${description}`

  console.log()
  console.log(lightCyan('----------------------------------'))
  console.log(`🌿 Git Branch: `, '\x1b[1m\x1b[43m', branchName, '\x1b[0m')
  console.log(lightCyan('----------------------------------'))
  console.log()

  // 自動複製到剪貼簿 (macOS)
  try {
    const copyProcess = exec('pbcopy')
    copyProcess.stdin.write(branchName)
    copyProcess.stdin.end()
    console.log(lightGreen('📋 已將 Branch Name 自動複製到剪貼簿！'))
  } catch (e) {
    console.log(red('無法自動複製到剪貼簿'))
  }
}
