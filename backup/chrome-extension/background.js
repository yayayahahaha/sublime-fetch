chrome.runtime.onMessage.addListener((message /*, sender, sendResponse*/) => {
  if (message.action !== 'openTabWithToken') return

  chrome.tabs.create({ url: message.url }, (tab) => {
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
        args: [message.token],
      })
      chrome.tabs.onUpdated.removeListener(listener)
    }
    chrome.tabs.onUpdated.addListener(listener)
  })
})
