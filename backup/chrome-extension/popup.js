const message = document.querySelector('#message')
function setMessage(value, { type = 'info' } = {}) {
  message.classList = ['message']

  message.innerHTML = value
  switch (type) {
    case 'error':
      message.classList.add('error')
  }
}

document.addEventListener('DOMContentLoaded', function () {
  copyBranchNameByJira()
})

function copyBranchNameByJira() {
  const jiraBranchInput = document.querySelector('#jira-branch-input')
  const jiraBranchBtn = document.querySelector('#jira-branch-btn')
  const jiraBranchStorageKey = 'previous-jira-user-name'

  const previousName = localStorage.getItem(jiraBranchStorageKey) || ''
  jiraBranchInput.value = previousName

  jiraBranchInput.addEventListener('input', function () {
    localStorage.setItem(jiraBranchStorageKey, this.value)
  })

  jiraBranchBtn.addEventListener('click', async function () {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: function () {
        // 在當前頁面上執行的函數，能夠操作頁面 `document`
        const title = document.querySelector('title')?.innerText || '' // 獲取頁面標題
        return { title }
      },
    })

    const { title } = result
    const [, jiraNum, rest] = title.match(/^\[(\w+-\d+)\](.+)-\sJira$/) ?? []
    if (jiraNum == null) {
      setMessage('這個頁面看起來不能產出 branch name', { type: 'error' })
      return
    }

    const name = rest.replace(/[^\w]/g, '-').replace(/-+/g, '-').replace(/^-/, '').replace(/-$/, '')
    const userName = jiraBranchInput.value

    const copiedText = `${userName}/${jiraNum}_${name}`

    await navigator.clipboard.writeText(copiedText)
    setMessage(`
      <p>複製成功</p>
      <b>${copiedText}</b>
    `)
  })
}
