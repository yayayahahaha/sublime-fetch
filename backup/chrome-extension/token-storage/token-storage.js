document.addEventListener('DOMContentLoaded', tokenStorage)

function tokenStorage() {
  const copyString = window.copyString
  const setMessage = window.setMessage

  const tokenTable = document.querySelector('table[token]')
  const tbody = tokenTable.querySelector('tbody')
  const demoField = document.querySelector('[demo-field]')

  let list = (() => {
    try {
      const data = JSON.parse(localStorage.getItem('token-list'))
      if (Array.isArray(data)) return data
      return []
    } catch {
      return []
    }
  })()

  function genNewItem({ id, token, name }) {
    const newItem = demoField.cloneNode(true)
    newItem.removeAttribute('demo-field')

    const input = newItem.querySelector('input')
    input.value = name
    input.addEventListener('input', function (event) {
      localStorage.setItem(
        'token-list',
        JSON.stringify(
          list.map((item) => {
            if (item.id === id) item.name = event.target.value
            return item
          }),
          null,
          2
        )
      )
    })
    const deleteBtn = newItem.querySelector('.icon.icon-delete')
    deleteBtn.addEventListener('click', () => {
      newItem.remove()
      list = list.filter((item) => item.id !== id)
      localStorage.setItem('token-list', JSON.stringify(list, null, 2))
    })
    const setBtn = newItem.querySelector('.icon.icon-set')
    setBtn.addEventListener('click', async function () {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: function (token) {
          localStorage.setItem('token', token)
          window.location = window.location.href
          return localStorage.getItem('token')
        },
        args: [token],
      })
    })
    const takeBtn = newItem.querySelector('.icon.icon-take')
    takeBtn.addEventListener('click', () => {
      copyString(token)
      setMessage(`複製成功`)
    })

    return newItem
  }

  const storageItems = list.map((item) => genNewItem(item))
  storageItems.forEach((dom) => tbody.appendChild(dom))

  const button = document.querySelector('#copy-token')
  button.addEventListener('click', async function () {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: function () {
        // 在當前頁面上執行的函數，能夠操作頁面 `document`
        const token = window.localStorage.getItem('token')
        const title = document.querySelector('title')
        const hostname = window.location.hostname
        return { token, title: title.innerText, hostname }
      },
    })
    const { token, title, hostname } = result
    if (token == null) {
      setMessage(`J 個頁面看起來沒有 token`, { type: 'error' })
      return
    }

    // 創建新 item
    const id = `pk-${Date.now()}`
    const name = /localhost/.test(hostname) ? title : hostname
    const newItem = genNewItem({ id, name, token })
    tbody.appendChild(newItem)

    list.push({ id, token, name })
    localStorage.setItem('token-list', JSON.stringify(list, null, 2))

    await copyString(token)
  })

  const buttonExortToken = document.querySelector('#exort-token')
  buttonExortToken.addEventListener('click', () => copyString(JSON.stringify(list, null, 2)))
}
