import { exec } from 'child_process'
import { lightGreen, red, blue, lightCyan, yellow } from '../color.js'
import select from '@inquirer/select'

function runAppleScript(script) {
  return new Promise((resolve) => {
    exec(`osascript -e '${script}'`, (err, stdout) => {
      if (err) resolve('')
      else resolve(stdout.trim())
    })
  })
}

// 輔助函式：將字串存入剪貼簿 (處理特殊字元)
async function copyToClipboard(text) {
  // 使用 AppleScript 的 quoted form 來確保特殊字元不會導致 shell 報錯
  const script = `set the clipboard to ${JSON.stringify(text)}`
  await runAppleScript(script)
}

export async function chromeWindowHelper() {
  try {
    const getWindowsScript = `
      set output to ""
      tell application "Google Chrome"
        set windowList to windows
        repeat with w in windowList
          set wId to id of w as string
          set tabCount to count tabs of w
          
          set tabUrls to {}
          set maxTabs to 3
          if tabCount < 3 then set maxTabs to tabCount
          
          repeat with i from 1 to maxTabs
            copy URL of tab i of w to end of tabUrls
          end repeat
          
          set urlsStr to ""
          repeat with u in tabUrls
            set urlsStr to urlsStr & u & "||"
          end repeat
          
          set output to output & wId & "|||" & tabCount & "|||" & urlsStr & "???"
        end repeat
      end tell
      return output
    `
    
    console.log(lightCyan('正在獲取 Chrome 視窗資訊...'))
    const rawWindows = await runAppleScript(getWindowsScript)
    
    if (!rawWindows) {
      console.log(red('找不到任何開啟的 Chrome 視窗。'))
      return
    }

    const windowChoices = rawWindows.split('???').filter(Boolean).map(item => {
      const [id, count, urlsRaw] = item.split('|||')
      const totalTabs = parseInt(count, 10)
      const urls = urlsRaw.split('||').filter(Boolean)
      
      let domains = urls.map(u => {
        try {
          const urlObj = new URL(u)
          if (urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1') {
            return `${urlObj.hostname}${urlObj.port ? ':' + urlObj.port : ''}`
          }
          return urlObj.hostname
        } catch (e) {
          return 'newtab'
        }
      }).join(', ')

      if (totalTabs > 3) domains += '...'

      return { 
        name: `[ID: ${id}] ${totalTabs} tabs (${domains})`, 
        value: id 
      }
    })

    const selectedWindowId = await select({
      message: '請選擇要操作的 Chrome 視窗:',
      choices: windowChoices
    })

    const action = await select({
      message: '你想做什麼?',
      choices: [
        { name: '刷新該視窗的所有頁籤', value: 'REFRESH' },
        { name: '複製該視窗所有頁籤的網址 (URLs)', value: 'COPY_URLS' }
      ]
    })

    if (action === 'REFRESH') {
      await runAppleScript(`
        tell application "Google Chrome"
          repeat with t in tabs of window id ${selectedWindowId}
            reload t
          end repeat
        end tell
      `)
      console.log(lightGreen('✅ 該視窗的分頁已全部刷新！'))
    } 
    
    else if (action === 'COPY_URLS') {
      // 1. 先抓取所有原始網址
      const rawUrlsStr = await runAppleScript(`
        tell application "Google Chrome"
          set urlList to ""
          repeat with t in tabs of window id ${selectedWindowId}
            set urlList to urlList & URL of t & "||"
          end repeat
          return urlList
        end tell
      `)
      
      const urlArray = rawUrlsStr.split('||').filter(Boolean)
      
      if (urlArray.length === 0) {
        console.log(yellow('該視窗沒有任何網址可供複製。'))
        return
      }

      // 2. 選擇格式
      const format = await select({
        message: '請選擇複製格式:',
        choices: [
          { name: 'JSON Array (例如: ["url1", "url2"])', value: 'JSON' },
          { name: '純文字 (換行分隔)', value: 'TEXT' }
        ],
        default: 'JSON'
      })

      // 3. 根據格式轉換並複製
      let finalString = ''
      if (format === 'JSON') {
        finalString = JSON.stringify(urlArray, null, 2)
      } else {
        finalString = urlArray.join('\n')
      }

      await copyToClipboard(finalString)
      console.log(lightGreen(`📋 已成功複製 ${urlArray.length} 個網址 (格式: ${format})！`))
    }

  } catch (err) {
    console.log(red('操作失敗：'), err.message)
  }
}
