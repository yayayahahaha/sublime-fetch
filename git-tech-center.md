# Git

> 健忘者皮夾

### Git ssh 權限設定

除了 `ssh-keygen` 以外，還要設定一個 `known_host` 項目，參見以下流程

```bash
# keygen  的部分, 可以一直按 enter 或是輸入自己想要的名字
# 結束後會在 .ssh 底下產一組私鑰和金鑰
ssh-keygen -t rsa -C "yayayahahahaooii@gmail.com"

# known_host 的部分
ssh-keyscan -t rsa github.com >> ~/.ssh/known_hosts

# 最後 copy, 可以直接貼上
cat ~/.ssh/id_rsa.pub | pbcopy
```

然後到 [`github`](https://github.com/settings/keys) 上新增一組金鑰就可以了

> [參考資料](https://stackoverflow.com/questions/13363553/git-error-host-key-verification-failed-when-connecting-to-remote-repository)

#### 指定 git 用不同的 ssh-key 向 remote 請求

```bash
# 首先是 keygen, 這時要記得輸入的名字，這邊都以 flyc-mac 為例子
cd ~/.ssh
ssh-keygen -t rsa -C "yayayahahahaooii@gmail.com"
# 接著在第一個步驟輸入 flyc-mac

# 再來用 ssh-add 添加 flyc-mac 後，檢查有沒有添加成功
ssh-add ~/.ssh/flyc-mac
ssh-add -l

# 創建、或是直接修改 ~/.ssh/config 檔案
touch ~/.ssh/config
```

接著，修改 `~/.ssh/config` 裡的內容

```bash
Host flyc-mac-custom-name # 這個是名字，可以自己取
  HostName github.com
  User git
  IdentityFile ~/.ssh/flyc-mac
```

就完成用自己指定的 `ssh-key` 來對 github 做請求了

##### 額外補充

```bash
# 可以透過 ssh-add -D 來刪除所有的 cached-key
ssh-add -D

# 可以透過 ssh-add -l 來看當前有的 cached-key
ssh-add -l
```

> [參考資料 1](https://gist.github.com/jexchan/2351996)  
> [參考資料 2](https://superuser.com/questions/232373/how-to-tell-git-which-private-key-to-use) 的 nyxz 的解答

#### Q/A

##### Q: 是不是只要加了 `ssh-add` 之後就不用執行 `known_host` 那段了?

A: 經過測試很殘念還是需要 `known_host` 那段才行

##### Q: 是不是只要 `ssh-add` 和 `config` 設定過後就可以直接 `ssh` 請求或是其實兩個完全是在說不同的事情

A: `keygen` 那部分依舊是必要的, 不過這個還可以再去細查

---

### Git 在 commit 前添加 commit message 的預設值

可以透過直接修改專案裡的 `.git/hooks/prepare-commit-msg`，或是透過 git config 指定 hooks 的位置來處理。  
範例請見專案內的 `git-example-code-folder/_githooks/prepare-commit-msg`

##### 具體流程

1. 新增一個 `prepare-commit-msg` 的檔案在想要的位置, example: `~/project/_githooks/prepare-commit-msg`
2. 設定 gitconfig 裡的 `[core]` 的屬性如下:

```bash
[core]
  hooksPath = ~/project/_githooks
```

3. 檢查 config 有沒有設定成功

```bash
git config --get core.hooksPath # ~/project/_githooks
```

4. 在 `prepare-commit-msg` 裡面寫 code,

```bash
COMMIT_MSG_FILE=$1
# 'commit' 代表正在 ammend
# message 代表在 -m 或是 squash 或是 rebase-continue
# template 代表使用了模板
COMMIT_SOURCE=$2 # commit, message(-m), template, squash, merge, rebase

# 添加到第n行
n=1
CUSTOM_MESSAGE='hello world'
sed -i.bak -e "${n}s|^|$CUSTOM_MESSAGE\n|" $COMMIT_MSG_FILE
# 添加到最末行
echo "\n# [額外訊息]" >> "$COMMIT_MSG_FILE"

```

即可透過撰寫 shell 檔案來決定要呈現什麼樣的訊息在 commit message 裡
