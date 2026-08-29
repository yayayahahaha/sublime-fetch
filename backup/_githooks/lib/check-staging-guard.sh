# 共用邏輯：merge 進 staging 之前，檢查來源 commit 是否已經進過 origin/dev
#
# 由誰呼叫：
# - prepare-commit-msg：無衝突的合併（git merge --no-ff 等）。git 在這個 hook 執行前，
#   才會把 MERGE_HEAD 寫入磁碟，pre-merge-commit 執行時 MERGE_HEAD 還不存在，
#   所以檢查不能放在 pre-merge-commit，這是最早能看到 MERGE_HEAD 的地方。
# - pre-commit：合併有衝突、需要手動 resolve 後 git commit 完成合併時，
#   這種情境下 MERGE_HEAD 在合併中斷時就已經寫入，可以更早在這裡擋下來。
#
# 注意：這裡不會主動 git fetch，只看本機快取的 origin/dev（避免每次合併都要多等
# 幾秒 SSH 往返）。如果來源分支剛進 dev 沒多久、本機還沒 fetch 過，可能會被誤擋，
# 手動 `git fetch origin dev` 後重試即可；不會有「誤放行」的風險，只會誤擋。
#
# 這個檢查放在 prepare-commit-msg，git 的 --no-verify 對這個 hook 沒有效果（--no-verify
# 只跳過 pre-commit / pre-merge-commit / commit-msg）。

check_staging_guard() {
  local branch
  branch=$(git symbolic-ref --short HEAD 2>/dev/null) || return 0
  [[ "$branch" != "staging" ]] && return 0

  local merge_head_sha
  merge_head_sha=$(git rev-parse -q --verify MERGE_HEAD 2>/dev/null)
  [[ -z "$merge_head_sha" ]] && return 0 # 不是在做 merge，放行

  if ! git rev-parse -q --verify origin/dev >/dev/null 2>&1; then
    echo "⚠️  本機沒有 origin/dev 的快取，略過檢查，請自行確認來源分支已經進過 dev"
    return 0
  fi

  if ! git merge-base --is-ancestor "$merge_head_sha" origin/dev 2>/dev/null; then
    echo ""
    echo "🚫🚫🚫 commit ${merge_head_sha} 還沒進過 origin/dev 🚫🚫🚫"
    echo "🚫🚫🚫 依照規範要先把來源分支 merge 進 dev，再合併進 staging 🚫🚫🚫"
    echo ""
    echo "如果你確定來源已經進過 dev，只是本機快取太舊，先 git fetch origin dev 再重試"
    echo "若要放棄這次合併，可用 git merge --abort"
    return 1
  fi

  return 0
}
