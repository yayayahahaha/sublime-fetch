# 新 Mac 建構流程

## Mac 本身設定

如取消各種手勢、觸控板方向調整、拖拉方式修改、快捷鍵調整、繁簡轉換等  
還沒找如何匯出 or 詳細的每個步驟，不過數量不多應該還好

## Karabiner Element 鍵盤鍵位修改程式

複製資料夾即可

```bash
cp ./karabiner $HOME/.config/karabiner
```

> 這個可以寫到[`怎麼使用 karabiner element`](./怎麼使用karabiner.md) 那裏

> 如果 Mac 預設找不到需要的權限的話，到這裡找  
> karabiner_grabber: `/Library/Application Support/org.pqrs/Karabiner-Elements/bin/karabiner_grabber`  
> karabiner_observer: `/Library/Application Support/org.pqrs/Karabiner-Elements/bin/karabiner_observer`  
> Karabiner-EventViewer: 在 `applicatoin 應用程式` 裡面就可以找到  
> source https://github.com/pqrs-org/Karabiner-Elements/issues/1867

## Sublime Text 編輯器

依照 [這裡](https://github.com/yayayahahaha/sublime3_package_backup) 的流程去處理  
或是直接安裝 `Package Control` 後關閉 `SublimeText`、接著執行 `set-sublime-text-user.sh` 即可

```bash
sh set-sublime-text-user.sh
```

## Edge 瀏覽器

登入即可同步大部分如書籤等等的設定，其他要調整的項目如下:

- `tra` 和 `tras` 的 `Google Translator` 快捷鍵  
- 調整預設的搜尋引擎 Bing -> Google  
- Snippets 的相關檔案  

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

### 安裝 brew

> 安裝 `brew` 之前要裝 `git`, `brew` 在安裝的時候會需要

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

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

### rc 相關設定

##### 對 `.zshrc` 的調整


###### Theme 樣式

同 oh-my-zsh 的設定所說，調整 `ZSH_THEME` 即可

```bash
# ...
ZSH_THEME="agnoster"
# ...
```

###### Plugins 套件

調整 `plugins=( 這裡 )` 的項目，預設有 `git`

```bash
# ...
plugins=(
  git
)
# ...
```

接著是rc那些:
1. 複製 .zshrc-for-mac 到 ~/.zshrc # oh-my-zsh 如果不用複製的話，可以寫成"如何調整"的那種文件好像就可以了? 這次可以重新開始
2. 複製 .zshrc.pre-oh-my-zsh-for-mac	 到 ~/.zshrc.pre-oh-my-zsh # 同
3. 複製 .bashrc-for-mac 到 ~/.bashrc
4. 複製 .bash-git-for-mac 到 ~/.bash-git
5. 複製 .git-completion.bash 到 ~/.git-completion.bash # ?
6. 複製 .gitconfig-for-mac 到 ~/.gitconfig
7. 創建新的/複製舊的 .bash-work-for-mac 到 ~/.bash-work
8. 創建 .vimrc -> 內容很少，所以還好 (nu, autoindent, tabstop=2, hlsearch)
9. 把 s 綁到環境變數裡面 ln -s /Applications/Sublime\ Text.app/Contents/SharedSupport/bin/subl /usr/local/bin/.
10. 重啟 iterm

TODO 這些看要不要寫成腳本?	
