/**
 * Jira Ticket Automation Snippet
 * 適用於 btse.atlassian.net
 */
;(async function () {
  const CONFIG = {
    projectText: 'Platform (PLAT)',
    workTypeText: 'Task',
    selectors: {
      createBtn: 'span[data-testid="ak-spotlight-target-global-create-spotlight"] button',
      projectSelectId: 'issue-create.ui.modal.create-form.project-picker.project-select',
      workTypeSelectId: 'inline-config-buttons-for-select.atlaskit-select-inline-tab-activator',
      listbox: '#react-select-2-listbox',
      options: '[role="option"]',
      loadingSvg: '.-ValueContainer div[class*="-IndicatorsContainer"] svg',
    },
  }

  const waitForElement = (checkFn, name = 'Element', timeout = 5000) => {
    return new Promise((resolve, reject) => {
      const res = checkFn()
      if (res) return resolve(res)

      const timer = setInterval(() => {
        const res = checkFn()
        if (res) {
          clearInterval(timer)
          clearTimeout(timeoutId)
          resolve(res)
        }
      }, 100)

      const timeoutId = setTimeout(() => {
        clearInterval(timer)
        reject(new Error(`Timeout waiting for ${name}`))
      }, timeout)
    })
  }

  const waitForNotLoading = (parentEl, name = 'Loading', timeout = 5000) => {
    return new Promise((resolve, reject) => {
      const isNotLoading = () => {
        const node = parentEl.querySelector(CONFIG.selectors.loadingSvg)
        return !node
      }

      // 這裡稍微等待一下，因為有時候 loading 會慢半拍才出現
      setTimeout(() => {
        if (isNotLoading()) return resolve()
        const timer = setInterval(() => {
          if (isNotLoading()) {
            clearInterval(timer)
            clearTimeout(timeoutId)
            resolve()
          }
        }, 100)

        const timeoutId = setTimeout(() => {
          clearInterval(timer)
          reject(new Error(`Timeout waiting for ${name} to finish`))
        }, timeout)
      }, 300)
    })
  }

  try {
    console.log('🚀 開始自動化流程...')

    // 1. 點擊全域創建按鈕
    const createBtn = document.querySelector(CONFIG.selectors.createBtn)
    if (!createBtn) throw new Error('找不到創建按鈕')
    createBtn.click()

    // 2. 等待 Space 下拉選單出現
    const projectSelect = await waitForElement(
      () => document.getElementById(CONFIG.selectors.projectSelectId),
      'Project Select'
    )
    console.log('✅ 找到 Space 下拉選單')

    // 3. 等待 Space 下拉選單的 Loading 消失
    console.log('⏳ 等待 Space 載入資料...')
    await waitForNotLoading(projectSelect, 'Space Loading')
    console.log('✅ Space 載入完成')

    // 4. 選取 Project
    await new Promise((r) => {
      setTimeout(() => {
        console.log('開始點擊')

        document
          // .getElementById(CONFIG.selectors.projectSelectId)
          .getElementById('issue-create.ui.modal.create-form.project-picker.project-select')
          .querySelector('svg')
          .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

        r()
      }, 3000)
    })
    const listbox = await waitForElement(() => document.querySelector(CONFIG.selectors.listbox), 'Listbox')
    const options = Array.from(listbox.querySelectorAll(CONFIG.selectors.options))
    const targetOption = options.find((el) => el.innerText.includes(CONFIG.projectText))

    if (targetOption) {
      targetOption.click()
      console.log(`✅ 已選取專案: ${CONFIG.projectText}`)
    }

    // 5. 等待 Work Type 更新
    console.log('⏳ 等待 Work Type 更新...')
    const workTypeContainer = await waitForElement(
      () => document.getElementById(CONFIG.selectors.workTypeSelectId),
      'Work Type Container'
    )
    await waitForNotLoading(workTypeContainer, 'Work Type Loading')

    // 6. 點擊 Work Type 選單
    workTypeContainer.click()
    console.log('✅ 已點擊 Work Type 選單')
  } catch (err) {
    console.error('❌ 自動化失敗:', err.message)
  }
})()
