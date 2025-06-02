const STORAGE_KEY = 'semi-auto-login-list'
let list = []

// 讀取 localStorage，如果有資料，重建所有區塊
function init() {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    try {
      list = JSON.parse(stored)
    } catch (e) {
      console.error('localStorage 解析失敗', e)
      list = []
    }
  }
  list.forEach((data, idx) => createBlock(data, idx))
  sortFn()
}

// 儲存 list 到 localStorage
function saveList() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

// 新增一個區塊
function createBlock(data = {}, index) {
  const container = document.getElementById('semi-auto-login-container')
  const block = document.createElement('div')
  block.className = 'block'
  block.dataset.index = index

  // email input
  const email = document.createElement('input')
  email.type = 'text'
  email.placeholder = 'Email'
  email.value = data.email || ''
  email.addEventListener('input', () => {
    list[index].email = email.value
    saveList()
  })

  // password input
  const password = document.createElement('input')
  password.placeholder = 'Password'
  password.value = data.password || ''
  password.addEventListener('input', () => {
    list[index].password = password.value
    saveList()
  })

  // 2fa secret code input
  const twofa = document.createElement('input')
  twofa.type = 'text'
  twofa.placeholder = '2FA Secret Code'
  twofa.value = data.twofa || ''
  twofa.addEventListener('input', () => {
    list[index].twofa = twofa.value
    saveList()
  })

  // brand select
  const brand = document.createElement('select')
  const opts = [
    new window.Option('BTSE', ''),
    new window.Option('Lmex', 'lmex'),
    new window.Option('Traiex', 'traiex'),
    new window.Option('Nvx', 'nvx'),
  ]
  opts.forEach((otp) => brand.add(otp))
  brand.value = data.brand || ''
  brand.addEventListener('change', () => {
    list[index].brand = brand.value
    saveList()
  })

  // localhost port
  const port = document.createElement('input')
  port.type = 'text'
  port.placeholder = 'port'
  port.classList.add('port-input')
  port.value = data.port || ''
  port.addEventListener('input', () => {
    list[index].port = port.value
    saveList()
  })

  // sort
  const sortNum = document.createElement('input')
  sortNum.placeholder = '排序'
  sortNum.classList.add('sort-input')
  sortNum.type = 'number'
  sortNum.value = data.sort || ''
  sortNum.addEventListener('input', () => {
    list[index].sort = sortNum.value
    saveList()
  })

  // login 按鈕
  const loginBtn = document.createElement('button')
  loginBtn.textContent = '登入'
  loginBtn.addEventListener('click', () => {
    const payload = {
      email: list[index].email || '',
      password: list[index].password || '',
      secretCode2Fa: list[index].twofa || '',
      brandName: list[index].brand || null,
    }
    fetch('http://localhost:9999/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error != null) throw data.error

        console.log('登入回應：', data)

        // 如果有指定 port，則使用它，否則使用預設的 staging 環境
        const portValue = /^\d+$/.test(list[index].port) ? list[index].port : ''
        const url = portValue ? `http://localhost:${portValue}/` : data.data.websiteLink

        chrome.runtime.sendMessage({
          action: 'openTabWithToken',
          token: data.data.token,
          url,
        })
      })
      .catch((err) => {
        console.error('登入失敗：', err)
        window.alert('登入失敗，請查看 console')
      })
  })

  // 刪除按鈕
  const deleteBtn = document.createElement('button')
  deleteBtn.textContent = '刪除'
  deleteBtn.addEventListener('click', () => {
    list.splice(index, 1)
    saveList()
    renderAllBlocks()
  })

  // 複製區塊按鈕
  const copyBtn = document.createElement('button')
  copyBtn.textContent = '複製'
  copyBtn.addEventListener('click', () => {
    const newData = { ...list[index] }
    list.push(newData)
    saveList()
    sortFn()
    renderAllBlocks()
  })

  // 組合
  block.appendChild(loginBtn)
  block.appendChild(brand)
  block.appendChild(port)
  block.appendChild(email)
  block.appendChild(password)
  block.appendChild(twofa)
  block.appendChild(sortNum)
  block.appendChild(deleteBtn)
  block.appendChild(copyBtn)
  container.appendChild(block)
}

// 重新繪製所有區塊
function renderAllBlocks() {
  const container = document.getElementById('semi-auto-login-container')
  container.innerHTML = ''
  list.forEach((data, idx) => createBlock(data, idx))
}

// 點擊「添加半自動登入」
document.getElementById('semi-auto-login-addBtn').addEventListener('click', () => {
  list.push({ email: '', password: '', twofa: '', brand: '' })
  saveList()
  renderAllBlocks()
})

// 點擊排序按鈕
document.getElementById('semi-auto-login-sort').addEventListener('click', sortFn)
function sortFn() {
  list.sort((a, b) => (a.sort || 0) - (b.sort || 0))
  list = list.map((item, index) => {
    item.sort = index + 1
    return item
  })
  saveList()
  renderAllBlocks()
}

// 初始化
document.addEventListener('DOMContentLoaded', init)
