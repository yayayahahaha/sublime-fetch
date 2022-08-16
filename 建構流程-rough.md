# 新 Mac 建構流程

## Mac 本身設定

如取消各種手勢、觸控板方向調整、拖拉方式修改、快捷鍵調整、繁簡轉換等  

> TODO 還沒找如何匯出 or 詳細的每個步驟，不過數量不多應該還好

## Karabiner Element 鍵盤鍵位修改程式

複製資料夾即可

```bash
cp ./karabiner $HOME/.config/karabiner
```

> 如果 Mac 預設找不到需要的權限的話，到這裡找  
> karabiner_grabber: `/Library/Application Support/org.pqrs/Karabiner-Elements/bin/karabiner_grabber`  
> karabiner_observer: `/Library/Application Support/org.pqrs/Karabiner-Elements/bin/karabiner_observer`  
> Karabiner-EventViewer: 在 `applicatoin 應用程式` 裡面就可以找到  
> source https://github.com/pqrs-org/Karabiner-Elements/issues/1867

> TODO 這個可以寫到[`怎麼使用 karabiner element`](./怎麼使用karabiner.md) 那裏

## Sublime Text 編輯器

依照 [這裡](https://github.com/yayayahahaha/sublime3_package_backup) 的流程去處理  
或是直接安裝 `Package Control` 後關閉 `SublimeText`、接著執行 `set-sublime-text-user.sh` 即可

```bash
sh set-sublime-text-user.sh
```

> TODO 像是開啟同一個檔案然後可以看上下文的那種快捷鍵還沒有記得很熟  
> 或是把當前檔案移動到新的視窗的快捷鍵?  
> TODO 還沒處理掉 package 會噴的錯誤訊息  
> It appears a package is trying to ignore itself, causing a loop.
Please resolve by removing the offending ignored_packages setting.
> ---
> 1 missing dependency was just installed. Sublime Text should be restarted, otherwise one or more of the installed packages may not function properly.

## Sublime Merge

> TODO 還沒寫
> 感覺也可以寫個自動化的腳本去拉這些檔案後把它們放到正確的位置?



## Edge 瀏覽器

登入即可同步大部分如書籤等等的設定，其他要調整的項目如下:

- `tra` 和 `tras` 的 `Google Translator` 快捷鍵  
- 調整預設的搜尋引擎 Bing -> Google  
- Snippets 的相關檔案  

> TODO 直接寫出來要怎麼調整吧，還有那些 `tra` 什麼的也就直接寫出來可以用複製的吧
> Snippet 的部分直接放進來這個資料夾算了

## Terminal 終端機

### 安裝 iterm2
直接從[官網](https://iterm2.com/)下載  

#### 如何同步 profile

###### 自動

`Preferences -> General -> Preferences -> Load preferences from a custom folder or URL` 選擇此 repo 的位置即可  

> 該行為會把此 `repo` 和 `iterm2` 當前的 `profile` 檔案同步

###### 手動

```bash
cp com.googlecode.iterm2.plist ~/Library/Preferences/com.googlecode.iterm2.plist
```

### 安裝 git

開啟 `iterm2` 後直接輸入 `git` 按確認，他會自己開始跑

##### git 權限設定
原本以為只要用 `ssh-keygen` 就可以了，沒想到還要設定一個 `known_host` 的項目

```bash
ssh-keygen -t rsa -C "yayayahahahaooii@gmail.com"
ssh-keyscan -t rsa github.com >> ~/.ssh/known_hosts
cat ~/.ssh/id_rsa.pub | pbcopy
```

然後到 [`github`](https://github.com/settings/keys) 上新增一組金鑰就可以了  
> [參考資料](https://stackoverflow.com/questions/13363553/git-error-host-key-verification-failed-when-connecting-to-remote-repository)

> TODO 要不要這整個流程也寫成腳本算了..
> 或是把 ssh-keygen 的部分補上就好?

### 安裝 brew

> 安裝 `brew` 之前要裝 `git`, `brew` 在安裝的時候會需要

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

> TODO 安裝 `brew` 的時候似乎會動到 `.zprofile` ? 因為裡面多了一個檔案
> 這個也要去查

### 安裝 oh-my-zsh

```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
```

##### oh-my-zsh 設定

###### Theme 設定

官方: [https://github.com/ohmyzsh/ohmyzsh/wiki/Themes](https://github.com/ohmyzsh/ohmyzsh/wiki/Themes)  
第三方: [https://github.com/ohmyzsh/ohmyzsh/wiki/External-themes](https://github.com/ohmyzsh/ohmyzsh/wiki/External-themes)  

要使用官方文件裡的 `theme` 的話只要將 `$HOME/.zshrc` 裡的 ZSH_THEME='這裡' 填上想要的 `theme` 名稱後重啟即可  
如果要使用第三方的 `theme` 的話就參考每一個 repo 裡獨立的 README 即可  

> TODO 感覺要備份整個 ~/.oh-my-zsh/custom 資料夾?  
> 如果有備份的話，重啟備份的順序就是 1. 先安裝 .oh-my-zsh   2. 把整個 custom 資料夾放進去  

###### 字型設定

如果要使用 [`agnoster`](https://github.com/agnoster/agnoster-zsh-theme) 這個 `theme` 的話會要額外安裝字型  
```bash
sudo apt-get install fonts-powerline
```
> [https://github.com/powerline/fonts](https://github.com/powerline/fonts)

> 安裝/同步完上述的項目後 `iterm2` 應該已經可以用 `option` 按鍵左右移動像是 `helloWorld` 等的字串單位了

### NodeJs

直接從[官網](https://nodejs.org/en/)安裝吧

> /usr/local/bin/node  
> /usr/local/bin/npm  

> TODO 安裝 pnpm、共用 prettier、還有 eslint 等東西的預設值  
> 感覺這些項目要和 sublime text 相關的設定之類的東西一起寫? 像是 SublimeLinter 和 jsPrettier 之類的做搭配解說  
> 還有安裝 n 或是看有沒有其他更好用的切換版本裝置


### rc 相關設定

直接執行腳本後即可

```bash
# 到這裡應該已經安裝好 `zsh` 了，所以在使用的時候要用 zsh 來呼叫
zsh set-rc-files.sh
```

TODO  
設定完後要手動處理的部分還沒寫:  
git 的公司子層 repo email 設定, 在 `.gitconfig` 裡  
TODO 整理: 這裡要每一個 zshrc 再去看一下, 更新這些項目的東東也要整理一下  
TODO 製作一個各種 rc 檔案的捷徑(ln ?)資料夾，這個應該也可以用腳本去跑就可以了  
TODO 裝完之後，目前的 git diff 是壞的.. 再看看是發生什麼事了, 我猜是和 .bashrc 寫成了 .zprofile 有關?  
-> 實測之後有關，判斷應該是顏色的部分受到影響了  

> 同步的項目:

> - `.zshrc`: zsh 主檔
> - `.zprofile`: profile 檔
> - `.bash-git`: 自己寫的 `git` 相關指令
> - `.gitconfig`: `git` 設定檔
> - `.vimrc`: `vim` 設定檔

> TODO 有一個叫 `.git-completion.bash` 的不知道用不用得到?

##### 對 `.zshrc` 的調整

###### Theme 樣式

同 oh-my-zsh 的設定所說，調整 `ZSH_THEME` 即可

```bash
# ...
ZSH_THEME="agnoster"
# ...
```

###### Plugins 套件

調整 `plugins=( 這裡 )` 的項目，預設有 `git`。[官方文件在這裡](https://github.com/ohmyzsh/ohmyzsh/wiki/Plugins)

```bash
# ...
plugins=(
  git
)
# ...
```

> TODO 不知道 zsh 到底有哪些 plugins? 可以看一下

---

> TODO 撰寫自己的 tech center 吧  
> 筆記: sublime text 把特定副檔名指定成特定 syntax 的方式?  
> sublime text 使用 eslint 的方式 -> sublimeLinter? default setting? home path setting?  
> sublime text 使用 prettier 的方式  
> sublime text 使用 LSP 的方式  
> 自己客製化 eslint 的方式? 換行、空白、提示等  
> pnpm 如果在安裝的時候當前目錄下沒有 package.json 的話東西會去哪裡?  
> pnpm 的快取檔案在哪裡?  
> 除了 n 以外有沒有更好用的切換版本方式?  
> vue3 + vite + windicss && vue2 + vite + windicss  相關的各種設定等  
> 參考 BBDS 的那個客製化的 vite plugins ?  
> 試試看 telport, vue3 的一個概念, 作用於想把 dialog 的層級拉到動 body 等的這種需求會用到  
> 搞懂 custom component 的 v-model 概念  
> 重新整理 package.json 的方式  
> 將當前 git commit 變成 javascript global variable 的方式  
> git commit 前要做的事情? 或是 push 或 merge 前要做的事情  
> sublime text 好像有一個叫 better select 之類的東西? 像是可以雙向反白的  
