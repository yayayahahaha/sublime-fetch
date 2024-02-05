function _init_sublime_text_config() {
	local repo_path='git@github.com:yayayahahaha/sublime3_package_backup.git'
	local repo_name=sublime3_package_backup
	local sublime_text_package_fold="$HOME/Library/Application Support/Sublime Text/Packages/"

	echo $sublime_text_package_fold

	cd "$sublime_text_package_fold"
	if [[ $? != 0 ]]; then return; fi

	git clone $repo_path
	if [[ $? != 0 ]]; then return; fi

	rm -rf User
	if [[ $? != 0 ]]; then return; fi

	mv $repo_name User
	if [[ $? != 0 ]]; then return; fi

	echo '操作成功'
}
_init_sublime_text_config