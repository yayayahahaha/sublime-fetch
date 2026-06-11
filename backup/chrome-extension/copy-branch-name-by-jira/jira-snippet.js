/**
 * Jira Branch Name Generator (Chrome Snippet / Bookmarklet Version)
 */
(function() {
  try {
    let jiraNum = '';
    let descriptionRaw = '';

    // 1. 優先嘗試從頁面 DOM 取得 (精確版 Jira UI 選擇器)
    const domJiraNum = document.querySelector('[role="presentation"] a[aria-current="page"] span')?.innerText;
    const domDescription = document.querySelector('[role="presentation"] h1')?.innerText;

    if (domJiraNum && domDescription) {
      jiraNum = domJiraNum.trim();
      descriptionRaw = domDescription.trim();
    } else {
      // 2. 如果 DOM 找不到，嘗試解析頁面 Title
      const title = document.querySelector('title')?.innerText || '';
      const match = title.match(/^\[(\w+-\d+)\]\s*(.+)\s*-\s*Jira$/);
      
      if (match) {
        jiraNum = match[1];
        descriptionRaw = match[2];
      }
    }

    // 檢查是否成功取得資訊
    if (!jiraNum || !descriptionRaw) {
      const currentTitle = document.querySelector('title')?.innerText || '無法取得標題';
      alert("❌ 取得 Jira 資訊失敗：無法從頁面 DOM 或標題解析出單號與描述。\n\n目前頁面標題：\n" + currentTitle);
      return;
    }

    // 3. 取得使用者名稱（確定有資訊後再詢問）
    const JIRA_BRANCH_STORAGE_KEY = 'previous-jira-user-name';
    let userName = localStorage.getItem(JIRA_BRANCH_STORAGE_KEY) || 'user';
    const inputName = prompt("請確認你的名字 (用於 branch prefix):", userName);
    if (inputName === null) return; 
    
    userName = inputName.trim() || 'user';
    localStorage.setItem(JIRA_BRANCH_STORAGE_KEY, userName);

    // 4. 格式化描述
    const description = descriptionRaw
      .replace(/[^\w\u4e00-\u9fff]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    const branchName = `${userName}/${jiraNum}_${description}`;

    // 5. 執行複製
    const el = document.createElement('textarea');
    el.value = branchName;
    el.setAttribute('readonly', '');
    el.style.position = 'absolute';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    const success = document.execCommand('copy');
    document.body.removeChild(el);

    if (success) {
      console.log("%c🚀 Branch Name 已複製:", "color: #00ff00; font-weight: bold;", branchName);
      const toast = document.createElement('div');
      toast.innerText = "✅ 已複製: " + branchName;
      Object.assign(toast.style, {
        position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
        backgroundColor: '#28a745', color: 'white', padding: '10px 20px',
        borderRadius: '5px', zIndex: '9999', fontWeight: 'bold', boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
      });
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2000);
    } else {
      alert("❌ 複製失敗，請手動複製控制台內容。");
    }
  } catch (err) {
    alert("❌ 發生未預期的錯誤：\n" + err.message);
  }
})();
