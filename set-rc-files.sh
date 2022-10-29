function set_rc_files() {
  __copy_and_backup

  # 複製的部分
  cp ./.zshrc-backup "$HOME/.zshrc"
  if [[ $? != 0 ]]; then return; fi

  cp ./.zprofile-backup "$HOME/.zprofile"
  if [[ $? != 0 ]]; then return; fi

  cp ./.bash-git-backup "$HOME/.bash-git"
  if [[ $? != 0 ]]; then return; fi

  cp ./.gitconfig-backup "$HOME/.gitconfig"
  if [[ $? != 0 ]]; then return; fi

  cp ./.vimrc-backup "$HOME/.vimrc"
  if [[ $? != 0 ]]; then return; fi


  # 把 sublime text 的啟動檔綁定成綁到環境變數 bin 資料夾下的 subl
  # 用以快速啟動 sublime text
  # 接著會在 .zprofile 裡將 s 綁定啟動相關的參數
  sudo mkdir -p /usr/local/bin
  sudo rm -rf '/usr/local/bin/subl'
  sudo ln -s '/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl' '/usr/local/bin/.'
  if [[ $? != 0 ]]; then return; fi

  touch "$HOME/.bash-work" # 這是空的
  if [[ $? != 0 ]]; then return; fi

  # 把設定檔 ln 到指定資料夾下
  local config_path='config-link'
  rm -rf "./$config_path/.zshrc"
  rm -rf "./$config_path/.zprofile"
  rm -rf "./$config_path/.bash-git"
  rm -rf "./$config_path/.gitconfig"
  rm -rf "./$config_path/.vimrc"

  ln -s "$HOME/.zshrc" "./$config_path/.zshrc"
  if [[ $? != 0 ]]; then return; fi

  ln -s "$HOME/.zprofile" "./$config_path/.zprofile"
  if [[ $? != 0 ]]; then return; fi

  ln -s "$HOME/.bash-git" "./$config_path/.bash-git"
  if [[ $? != 0 ]]; then return; fi

  ln -s "$HOME/.gitconfig" "./$config_path/.gitconfig"
  if [[ $? != 0 ]]; then return; fi

  ln -s "$HOME/.vimrc" "./$config_path/.vimrc"
  if [[ $? != 0 ]]; then return; fi


  echo '操作成功, 請重新開一個 iterm2 視窗'
}

function __copy_and_backup() {


  if [ -f "$HOME/.zshrc" ]; then
    echo "$HOME/.zshrc 已經存在，複製到 $HOME/.fetch-profile-backup"
    mkdir -p "$HOME/.fetch-profile-backup"
    file_name=".zshrc_$(date +%s)"
    cp "$HOME/.zshrc" "$HOME/.fetch-profile-backup/$file_name"
    echo "$file_name 複製成功"
  fi


  if [ -f "$HOME/.zprofile" ]; then
    echo "$HOME/.zprofile 已經存在，複製到 $HOME/.fetch-profile-backup"
    mkdir -p "$HOME/.fetch-profile-backup"
    file_name=".zprofile_$(date +%s)"
    cp "$HOME/.zprofile" "$HOME/.fetch-profile-backup/$file_name"
    echo "$file_name 複製成功"
  fi


  if [ -f "$HOME/.bash-git" ]; then
    echo "$HOME/.bash-git 已經存在，複製到 $HOME/.fetch-profile-backup"
    mkdir -p "$HOME/.fetch-profile-backup"
    file_name=".bash-git_$(date +%s)"
    cp "$HOME/.bash-git" "$HOME/.fetch-profile-backup/$file_name"
    echo "$file_name 複製成功"
  fi


  if [ -f "$HOME/.gitconfig" ]; then
    echo "$HOME/.gitconfig 已經存在，複製到 $HOME/.fetch-profile-backup"
    mkdir -p "$HOME/.fetch-profile-backup"
    file_name=".gitconfig_$(date +%s)"
    cp "$HOME/.gitconfig" "$HOME/.fetch-profile-backup/$file_name"
    echo "$file_name 複製成功"
  fi


  if [ -f "$HOME/.vimrc" ]; then
    echo "$HOME/.vimrc 已經存在，複製到 $HOME/.fetch-profile-backup"
    mkdir -p "$HOME/.fetch-profile-backup"
    file_name=".vimrc_$(date +%s)"
    cp "$HOME/.vimrc" "$HOME/.fetch-profile-backup/$file_name"
    echo "$file_name 複製成功"
  fi
}
set_rc_files