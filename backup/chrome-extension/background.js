chrome.runtime.onMessage.addListener((message /*, sender, sendResponse*/) => {
  if (message.action !== 'openTabWithToken') return

  const { token, url, toCookie = false } = message
  if (url == null) return
  if (token == null) return

  chrome.tabs.update({ url }, (tab) => {
    const listener = (tabId, info) => {
      if (tabId !== tab.id || info.status !== 'complete') return

      chrome.scripting.executeScript({
        target: { tabId },
        func: (tokenArg, toCookieArg, urlArg) => {
          if (toCookieArg) return void tokenInCookie()
          else return void tokenInLocalStorage()

          async function tokenInCookie() {
            await delay(1500)
            window.location = urlArg
            await delay(1500)
            const encoded = encodeURIComponent(tokenArg)
            document.cookie = `admin-token=${encoded}`
            await delay(2000)
            window.location = urlArg
          }

          function tokenInLocalStorage() {
            Object.keys(window.localStorage).forEach((key) => {
              window.localStorage.removeItem(key)
            })
            window.localStorage.setItem('token', tokenArg)
            window.location = urlArg
          }

          function delay(sec = 500) {
            return new Promise((resolve) => setTimeout(resolve, sec))
          }
        },
        args: [token, toCookie, url],
      })
      chrome.tabs.onUpdated.removeListener(listener)
    }
    chrome.tabs.onUpdated.addListener(listener)
  })
})
