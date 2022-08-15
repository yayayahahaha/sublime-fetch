function set_rc_files() {
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


  # 把 s 綁到環境變數裡面用以快速啟動 sublime text
  ln -s '/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl' '/usr/local/bin/.'
  if [[ $? != 0 ]]; then return; fi

  touch "$HOME/.bash-work" # 這是空的
  if [[ $? != 0 ]]; then return; fi

  echo '操作成功'
}
set_rc_files
source "$HOME/.zshrc"