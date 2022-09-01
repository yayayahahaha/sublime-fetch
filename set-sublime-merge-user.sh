function _init_sublime_merge_config() {
	local repo_path='git@github.com:yayayahahaha/sublime-merge-pacakge-user.git'
	local repo_name='sublime-merge-pacakge-user'
	local sublime_merge_package_fold="$HOME/Library/Application Support/Sublime Merge/Packages/"

	echo $sublime_merge_package_fold

	cd "$sublime_merge_package_fold"
	if [[ $? != 0 ]]; then return; fi

	git clone $repo_path
	if [[ $? != 0 ]]; then return; fi

	rm -rf User
	if [[ $? != 0 ]]; then return; fi

	mv $repo_name User
	if [[ $? != 0 ]]; then return; fi

	echo '操作成功'
}
_init_sublime_merge_config