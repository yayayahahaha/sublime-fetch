source ./_color.sh

show_message () {
  echo "${Cyan}$1${NC}"
}

show_title () {
  echo "${LightCyan}$1${NC}"
}

show_error () {
  echo "${LightRed}$1${NC}"
}

show_success () {
  echo "${Green}> $1${NC}"
  echo ""
}

check_error () {
  [[ "$1" != 0 ]] && echo "${LightRed}出錯啦${NC}" && exit "$2"
}

echo "${Yellow}開始在本地模擬整個流程${NC}"
echo ""

show_title "讀取參數"
if [ ! -f "./variables-setting.sh" ]; then
  show_error "檔案 variables-setting.sh 不存在! 請從 variables-setting.sh.default 複製並修改"
  exit 1
else
  source "./variables-setting.sh"
fi
show_success "讀取參數成功"



show_title "檢查參數"
if [[ "$frontend_path" == '' ]]; then
  show_error "參數 frontend_path 不可為空"
  exit 1
fi
if [[ "$frontend_branch" == '' ]]; then
  show_error "參數 frontend_branch 不可為空"
  exit 1
fi
if [[ "$build_script" == '' ]]; then
  show_error "參數 build_script 不可為空"
  exit 1
fi
if [[ "$bundle_dir_name" == '' ]]; then
  show_error "參數 bundle_dir_name 不可為空"
  exit 1
fi
show_success "檢查參數成功"



# 各種參數設定
lambda_repo_path=$(pwd)
worktree_folder='__worktree-for-simulation__'
TIMESTAMP=$(date +%s)
worktree_folder="$(dirname $frontend_path)/$worktree_folder"
worktree_path="$worktree_folder/__$TIMESTAMP--"
worktree_branch="__worktree-for-build-$TIMESTAMP--"


show_title "使用的參數"
echo "$(show_message "lambda_repo_path:") $lambda_repo_path"
echo
echo "$(show_message "frontend_path:") $frontend_path"
echo "$(show_message "frontend_branch:") $frontend_branch"
echo "$(show_message "build_script:") $build_script"
echo "$(show_message "bundle_dir_name:") $bundle_dir_name"
echo
echo "$(show_message "worktree_folder:") $worktree_folder"
echo "$(show_message "worktree_path:") $worktree_path"
echo "$(show_message "worktree_branch:") $worktree_branch"
echo ''

show_title "切換到 frontend repo"
echo "當前 pwd: $(pwd)"
cd $frontend_path
check_error $? 2
echo "結束的時候的pwd: $(pwd)"
echo ''


show_title "創建 worktree: $worktree_path"
echo "當前 pwd: $(pwd)"
git worktree add -b "$worktree_branch" "$worktree_path" "$frontend_branch"
check_error $? 3
echo "結束的時候的pwd: $(pwd)"
echo ''


show_title "移動進 worktree: $worktree_path"
echo "當前 pwd: $(pwd)"
cd "$worktree_path"
check_error $? 4
echo "結束的時候的pwd: $(pwd)"
echo ''


show_title "安裝 packages"
echo "當前 pwd: $(pwd)"
yarn
check_error $? 5
echo "結束的時候的pwd: $(pwd)"
echo ''


show_title "執行 build script"
echo "當前 pwd: $(pwd)"
yarn "$build_script"
check_error $? 6
echo "結束的時候的pwd: $(pwd)"
echo ''


show_title "執行 build library script"
echo "當前 pwd: $(pwd)"
echo 'export default {}' > 'src/main.js'
BUILD_SCRIPT="$build_script"  ./build-lambda-variable.sh
check_error $? 7
echo "結束的時候的pwd: $(pwd)"
echo ''


show_title "創建資料夾與移動: $bundle_dir_name"
echo "當前 pwd: $(pwd)"
mv -f ./dist ./$bundle_dir_name
check_error $? 8
echo "結束的時候的pwd: $(pwd)"
echo ''


show_title "移除 lambda 資料夾裡原本就有的 bundleDir"
echo "當前 pwd: $(pwd)"
rm -rf "$lambda_repo_path/$bundle_dir_name"
check_error $? 9
echo "結束的時候的pwd: $(pwd)"
echo ''


show_title "把創好的資料夾移動到 lambda-for-ssr"
echo "當前 pwd: $(pwd)"
mv -f ./$bundle_dir_name $lambda_repo_path/
check_error $? 10
echo "結束的時候的pwd: $(pwd)"
echo ''


show_title "清除 worktree 和暫時的 branch"
echo "當前 pwd: $(pwd)"
show_message '切換到 HEAD commit'
git checkout $(git rev-parse HEAD)
show_message "移除 branch: $worktree_branch"
git branch -d $worktree_branch
show_message "切換回 frontend repo: $frontend_path"
cd "$frontend_path"
show_message "移除 worktree: $worktree_path"
rm -rf "$worktree_path"
show_message "修剪 worktree 狀態"
git worktree prune
check_error $? 111
echo "結束的時候的pwd: $(pwd)"
echo ''


show_title "移動目錄到 lambda-for-ssr 並產出會用到的 variables"
echo "當前 pwd: $(pwd)"
cd $lambda_repo_path
yarn &&
yarn generate-variables -- --bundle-dir-name $bundle_dir_name
check_error $? 112
echo "結束的時候的pwd: $(pwd)"
echo ''


show_title "基本測試 code 可不可以執行"
echo "當前 pwd: $(pwd)"
cd $lambda_repo_path
yarn test-variables
check_error $? 112
echo "結束的時候的pwd: $(pwd)"
echo ''


show_success "打包 lambda server"
echo "當前 pwd: $(pwd)"
yarn build
check_error $? 112
echo "結束的時候的pwd: $(pwd)"
echo ''

show_title "壓縮 lambda server 的 dist"
echo "當前 pwd: $(pwd)"
DIST_PATH=dist
ZIP_FILE_NAME=render-server.zip
ZIP_TARGET_PATH="$DIST_PATH/$ZIP_FILE_NAME"
ZIP_SOURCE_PATH="$DIST_PATH/*"
zip -j "$ZIP_TARGET_PATH" $ZIP_SOURCE_PATH
check_error $? 112
echo "結束的時候的pwd: $(pwd)"
echo ''

show_title "將 zip 上傳到 AWS S3 並更新 lambda"
echo "當前 pwd: $(pwd)"
yarn upload
check_error $? 113
echo "結束的時候的pwd: $(pwd)"
echo ''

show_title '🐋 成功 🐋'