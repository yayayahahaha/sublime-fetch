document.getElementById('refresh-all-tabs-btn').addEventListener('click', () => {
  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.reload(tab.id);
      }
    }
  });
});
