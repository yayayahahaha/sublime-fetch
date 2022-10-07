# Sublime Text Build System 中文亂碼

##### TL;DR

```bash
node_js_packages_path="$HOME/Library/Application Support/Sublime Text/Packages/Nodejs/"
cd "$node_js_packages_path"
file_name='Nodejs.sublime-build'
# 修改 Nodejs.sublime-build 裡的 encoding 成 utf8 即可
```

##### How to fix it

1. `cmd` + `shift` + `p` 叫出控制面板
2. 輸入 `Preference: Browse Packages` 並選擇，會開啟 Finder
3. 找到 `NodeJs` 資料夾下的 `Nodejs.sublime-build` 檔案，開啟它
4. 裡面有一行 `"encoding": "cp1252",`, 將 `"cp1252"` 改成 `"utf8"`
5. 重啟 Sublime Text 後即可

##### 注意事項

為了不改動到原本的 `Nodejs.sublime-build`, 也可以自己創一個 `Nodejs-utf8.sublime-build` 並複製貼上原本的內容再調整之類的  
只是這樣的話在執行 build 的時候就會出現一個選擇框來選擇要用哪個 build system

##### 參考文件

> https://blog.51cto.com/u_15216366/2833337  
> https://ithelp.ithome.com.tw/questions/10193486

##### TODO

不論是用複製的還是用原本的 Node build system  
在 Build 過後 LSP 的 typescript server 都會掛掉
