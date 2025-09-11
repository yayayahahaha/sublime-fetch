chrome.runtime.onMessage.addListener((message /*, sender, sendResponse*/) => {
  if (message.action !== 'openTabWithToken') return

  const { token, url } = message
  if (url == null) return
  if (token == null) return

  chrome.tabs.update({ url }, (tab) => {
    const listener = (tabId, info) => {
      if (tabId !== tab.id || info.status !== 'complete') return

      chrome.scripting.executeScript({
        target: { tabId },
        func: (tokenArg) => {
          Object.keys(window.localStorage).forEach((key) => {
            window.localStorage.removeItem(key)
          })

          window.localStorage.setItem('token', tokenArg)
          window.location = window.location.href
        },
        args: [token],
      })
      chrome.tabs.onUpdated.removeListener(listener)
    }
    chrome.tabs.onUpdated.addListener(listener)
  })
})
