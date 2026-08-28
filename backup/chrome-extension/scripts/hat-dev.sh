#!/usr/bin/env bash
# 啟動 🎩 repo 的 dev server：切到 flyc/🎩-tree-skaking-with-claude，rebase 到 origin/develop 最新後跑 yarn cm:dev。
# Ctrl+C 直接結束 server 即可，結束後維持在 flyc/🎩-tree-skaking-with-claude，不用切走。
set -euo pipefail

REPO_DIR="/Users/flyc.chung/btse/🎩"
FEATURE_BRANCH="flyc/🎩-tree-skaking-with-claude"

cd "$REPO_DIR"

yarn
git fetch
git checkout "$FEATURE_BRANCH"
git rebase "origin/develop^{commit}"
yarn cm:dev
