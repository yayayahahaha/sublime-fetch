(set -o igncr) 2>/dev/null && set -o igncr;

# Git branch bash completion
if [ -f ~/.git-completion.bash ]; then
  . ~/.git-completion.bash

  __git_complete g __git_main
  __git_complete gm __git_merge
  # __git_complete gp _git_pull
  __git_complete gp _git_checkout
  __git_complete gb _git_checkout

  __git_complete grm _git_checkout
  __git_complete grm-re _git_checkout
  __git_complete grmr _git_checkout
  __git_complete grmr-re _git_checkout
  __git_complete grmF _git_checkout
  __git_complete grmF-re _git_checkout

  __git_complete Agrm _git_checkout
  __git_complete Agrm-re _git_checkout
  __git_complete Agrmr _git_checkout
  __git_complete Agrmr-re _git_checkout
  __git_complete AgrmF _git_checkout
  __git_complete AgrmF-re _git_checkout

  __git_complete cbrp _git_checkout
fi

GOGOGO=~/go/src/gitlab.paradise-soft.com.tw

Black="\033[0;30m"
DarkGray="\033[1;30m"
Red="\033[0;31m"
LightRed="\033[1;31m"
Green="\033[0;32m"
LightGreen="\033[1;32m"
Orange="\033[0;33m"
Yellow="\033[1;33m"
Blue="\033[0;34m"
LightBlue="\033[1;34m"
Purple="\033[0;35m"
LightPurple="\033[1;35m"
Cyan="\033[0;36m"
LightCyan="\033[1;36m"
Light Gray="\033[0;37m"
White="\033[1;37m"
NC="\033[0m"

alias rb='source ~/.bashrc'

alias rl='_removeSymbLink'
alias rla='_removeAllSymbLink'

alias fo='_git_fetch_and_pull'
alias ff='_git_fetch_and_pull_all'

alias us='_update_sublime_fetch'

alias ph='phantomjs.exe'

alias pp='_findPort'
alias kk='_killPort'

alias ko='_killgo'

alias gr='_runGolang'

alias gogo="cd ${GOGOGO}/web/base"
alias glv="cd ${GOGOGO}/web/lv"
alias ghy="cd ${GOGOGO}/web/hy"
alias gtz="cd ${GOGOGO}/web/tz"
alias gc7="cd ${GOGOGO}/web/c7"
alias gc8="cd ${GOGOGO}/web/c8"
alias gbh="cd ${GOGOGO}/web/bh"
alias gls="cd ${GOGOGO}/web/ls"
alias gf="cd ${GOGOGO}/frontend"
alias gmi="cd ${GOGOGO}/frontend/reward"
alias gad="cd ${GOGOGO}/frontend/admin"

alias gre="cd ${GOGOGO}/frontend/reseller"
alias gbe="cd ${GOGOGO}/backend"

alias gnr="cd ${GOGOGO}/frontend/new_reseller"


alias gw="cd ~/workplace"
alias gs="cd ~/AppData/Roaming/Sublime\ Text\ 3/Packages/User"
alias gsp="_backup_sublime"

alias gb='_newBranch'

alias gget='_runGoGetStuff'
alias ggu='_runGulpStuff'
alias ggb='_runGoBuildStuff'
alias gma='_runGoMain'

alias gcm='git commit -m'
alias st='git st'
alias gc='git commit'
alias ga='git add -u :/'

alias greset='git add :/; git reset --hard;'
alias Agreset='_greset_all_brand'

alias ggg='_git_add_and_commit'
alias gg='_quick_git_add_and_commit'

alias gq='_git_checkout_to_qa'
alias gqq='_git_checkout_to_qa_and_pull'
alias gmq='_git_merge_branch_into_qa_and_push'

alias grm='_git_remove_local_branch'
alias grm-re='_git_remove_local_branch_and_recreate'

alias grmr='_git_remove_remote_branch'
alias grmr-re='_git_remove_remote_branch_and_recreate'

alias grmF='_git_remove_both_branch'
alias grmF-re='_git_remove_both_branch_and_recreate'

alias Agrm='_git_remove_local_branch_all'
alias Agrm-re='_git_remove_local_branch_and_recreate_all'

alias Agrmr='_git_remove_remote_branch_all'
alias Agrmr-re='_git_remove_remote_branch_and_recreate_all'

alias AgrmF='_git_remove_both_branch_all'
alias AgrmF-re='_git_remove_both_branch_and_recreate_all'

alias cbrp='_check_all_backend_repo_to'

alias op='explorer .'

function _git_merge_branch_into_qa_and_push() {
    local __git_branch=`git branch 2> /dev/null | grep -e ^* | sed -E  s/^\\\\\*\ \(.+\)$/\\\\\1\/`
    local __commit_word="Merge branch '$__git_branch' into 'qa'"

    git push
    gqq
    git merge --no-commit --no-ff $__git_branch
    git commit -m "$__commit_word"
    git push
    git ch $__git_branch
}

function _runGulpStuff() {
    dir=$(pwd);
    dir=${dir##*/};

    gulp --gulpfile "../base/scripts/gulpfile.js" clean --brand ${dir};
    gulp --gulpfile "../base/scripts/gulpfile.js" run --brand ${dir} --css scss;
}

function _runGoMain() {
    ./main.exe
}

function _runGoBuildStuff() {
    go build main.go
}

function _git_checkout_to_qa() {
    git ch qa;
}

function _git_checkout_to_qa_and_pull() {
    grm-re qa;
}

function _git_remove_both_branch_and_recreate() {
    if [[ $1 == '' ]]; then
        echo 'Please enter a branch name'
        return
    fi
    git fp
    grmF $1
    gb $1
}

function _git_remove_both_branch() {
    if [[ $1 == '' ]]; then
        echo 'Please enter a branch name'
        return
    fi
    grm $1
    grmr $1
}

function _git_remove_remote_branch_and_recreate() {
    if [[ $1 == '' ]]; then
        echo 'Please enter a branch name'
        return
    fi
    git fp
    grmr $1
    git ch $1;
    git push origin -u $1;
}

function _git_remove_local_branch_and_recreate() {
    if [[ $1 == '' ]]; then
        echo 'Please enter a branch name'
        return
    fi
    git fp
    grm $1
    git ch -b $1 origin/$1
}

function _git_remove_local_branch() {
    if [[ $1 == '' ]]; then
        echo 'Please enter a branch name'
        return
    fi

    echo '==================';
    echo "Branch Name: $1";
    echo '==================';

    git ch production
    git br -D $1
}

function _git_remove_remote_branch() {
    if [[ $1 == '' ]]; then
        echo 'Please enter a branch name'
        return
    fi

    echo '==================';
    echo "Branch Name: $1";
    echo '==================';

    branch_name=:$1;

    if [[ $2 == '' ]]; then
        git push origin $branch_name
    else
        git push $2 $branch_name
    fi
}

function returnStashStatus() {
    git_status=`git status 2> /dev/null`;
    # status part
    if [[ "${git_status}" != *"nothing to commit, working tree clean"* ]]; then
        echo "true"
    else
        echo "false"
    fi
}

function _git_fetch_and_pull() {
    haveToStash=$( returnStashStatus )
    local __git_branch=`git branch 2> /dev/null | grep -e ^* | sed -E  s/^\\\\\*\ \(.+\)$/\\\\\1\/`

    if [[ $haveToStash == "true" ]]; then
        echo -e "${LightPurple}have to stash${NC}: $(pwd)"
        git add :/
        git stash
    else
        echo -e "Don't have to stash"
    fi

    echo '============================='
    echo ''
    echo '1. Start git fetch:'
    git fp
    echo ''
    echo '2. Checkout to production and create a hook branch:'
    git ch production
    git ch -b tempBranchForFetching
    echo ''
    echo '3. Delete production branch, master branch and qa branch:'
    git br -D production
    git br -D master
    git br -D qa
    echo ''
    echo '4. Recreate production, master and qa branch by checkout remote branch:'
    git br production origin/production
    git br master origin/master
    git br qa origin/qa

    git ch $__git_branch
    echo ''
    echo '5. Remove tempBranchForFetching:'
    grm tempBranchForFetching
    echo ''

    if [[ $haveToStash == "true" ]]; then
        git stash pop
        git reset
    fi

    echo ''
    echo -e "${Cyan}6. Done: $(pwd)${NC}"
    echo '============================='
    echo ''
}

function _git_fetch_and_pull_all() {
    dir=$(pwd);

    gogo; fo &
    glv; fo &
    gls; fo &
    ghy; fo &
    gbh; fo &
    gc7; fo &
    gc8; fo &
    gtz; fo &
    gad; fo &
    gre; fo &

    cd "$dir"
}

function _show_dirty_status() {

    git_status=`git status 2> /dev/null`;
    local git_dirty_status_string=''
    # status part
    if [[ "${git_status}" != *"nothing to commit, working tree clean"* ]]; then
        # modified part
        if [[ "${git_status}" == *"Changes not staged for commit"* ]]; then
            git_dirty_status_string+="＊";
        fi

        # added part
        if [[ "${git_status}" == *"Changes to be committed"* ]]; then
            git_dirty_status_string+="+";
        fi

        # untracked part
        if [[ "${git_status}" == *"Untracked files:"* ]]; then
            git_dirty_status_string+="#";
        fi

        # conflict part
        if [[ "${git_status}" == *"Unmerged paths"* ]]; then
            git_dirty_status_string+="$";
        fi
    fi

    echo $git_dirty_status_string
}

function color_my_prompt() {
    local __user_and_host="$Yellow\u@\h"
    local __cur_location="$LightGreen\w"
    local __git_branch_color="${LightCyan}"
    #local __git_branch="\`ruby -e \"print (%x{git branch 2> /dev/null}.grep(/^\*/).first || '').gsub(/^\* (.+)$/, '(\1) ')\"\`"
    local __git_branch='`git branch 2> /dev/null | grep -e ^* | sed -E  s/^\\\\\*\ \(.+\)$/\(\\\\\1\)\/`'
    local __prompt_tail="${LightBlue}$"
    local __last_color="${NC}"
    # local __last_color="\[\033[00m\]"
    local __git_dirty_status='`_show_dirty_status`'
    # local __git_dirty_status=''

    export PS1="$__user_and_host $__cur_location $__git_branch_color$__git_branch$__git_dirty_status $__prompt_tail$__last_color \n"
}

function _findPort() {
    echo $1;
    netstat -ano | findstr $1
}

function _killPort() {
    # taskkill //PID $1 //F;
    taskkill /PID $1 /F;
}

function _killgo() {

    find1=$(netstat -ano | findstr :]:8090);
    pid1=${find1##*G};
    if [[ "${pid1}" != "" ]]; then
        # taskkill //PID ${pid1} //F;
        taskkill /PID ${pid1} /F;
    fi

    find2=$(netstat -ano | findstr :]:8091);
    pid2=${find2##*G};
    if [[ "${pid2}" != "" ]]; then
        # taskkill //PID ${pid2} //F;
        taskkill /PID ${pid2} /F;
    fi

    find3=$(netstat -ano | findstr :]:8080);
    pid3=${find3##*G};
    if [[ "${pid3}" != "" ]]; then
        # taskkill //PID ${pid3} //F;
        taskkill /PID ${pid3} /F;
    fi
}

function _newBranch() {
    git ch -b $1;
    git push origin $1;
    git br -u origin/$1;
}

function _runGoGetStuff() {
    go get -u -v --insecure;
}

function _runGolang() {

    dir=$(pwd);
    dir=${dir##*/};

    if [ "${dir}" == "admin" ]; then
        echo "current project: admin";
        echo "";

        find=$(netstat -ano | findstr :]:8090);

    elif [[ "${dir}" == reseller ]]; then
        echo "current project: reseller";
        echo "";

        find=$(netstat -ano | findstr :]:8091);

    elif [[ "${dir}" == task-mgmt ]]; then
        echo "current project: task-mgmt";
        echo "";

        find=$(netstat -ano | findstr :]:8000);

    elif [[ "${dir}" == base ]]; then
        echo "current project: base";
        echo "";

        find=$(netstat -ano | findstr :]:8080);

    elif [[ "${dir}" == mission ]]; then
        echo "current project: mission";
        echo "";

        find=$(netstat -ano | findstr :]:9090);

    else
        echo "current project: web";
        echo "current channel: ${dir}";
        echo "";

        find=$(netstat -ano | findstr :]:8080);


        gulp --gulpfile "../base/scripts/gulpfile.js" clean --brand ${dir};
        gulp --gulpfile "../base/scripts/gulpfile.js" run --brand ${dir} --css scss;

    fi

    pid=${find##*G};
    if [[ "${pid}" != "" ]]; then
        # taskkill //PID ${pid} //F;
        taskkill /PID ${pid} /F;
    fi

    echo "";
    echo "***Boosting golang server***";
    echo "";

    go run main.go;
}

function _removeSymbLink() {

    dir=$(pwd);
    dir=${dir##*/};

    if [ "${dir}" == "admin" ]; then
        echo "current project: admin";
        echo "";

        find=$(netstat -ano | findstr :]:8090);

    elif [[ "${dir}" == reseller ]]; then
        echo "current project: reseller";
        echo "";

        find=$(netstat -ano | findstr :]:8091);

    else
        echo "current project: web";
        echo "current channel: ${dir}";
        echo "";

        find=$(netstat -ano | findstr :]:8080);


        gulp --gulpfile "../base/scripts/gulpfile.js" clean --brand ${dir};
    fi

    pid=${find##*G};
    if [[ "${pid}" != "" ]]; then
        # taskkill //PID ${pid} //F;
        taskkill /PID ${pid} /F;
    fi

    echo "";
    echo "***Finished gulp clean***";
    echo "";

}

function _removeAllSymbLink() {
    dir=$(pwd);

    ghy ; rl &
    glv ; rl &
    gls ; rl &
    gc7 ; rl &
    gc8 ; rl &
    gbh ; rl &
    gtz ; rl &

    cd "$dir"
}

function _update_sublime_fetch() {
    cp ~/.bashrc ~/sublime_fetch/.bashrc
    cp ~/.gitconfig ~/sublime_fetch/git.gitconfig
    cd ~/sublime_fetch
    git st
}

function _backup_sublime() {
    dir=$(pwd);

    gs
    git add :/
    git commit -m "update"
    git push

    cd "$dir"
}

function _git_add_and_commit() {
    git add :/;
    git commit;
}

function _quick_git_add_and_commit() {
    if [[ $1 != '' ]]; then
        git add :/
        git commit -m "$1"
    else
        echo 'please enter commit message'
    fi
}

color_my_prompt

function _git_remove_local_branch_all() {
    echo "Function: _git_remove_local_branch_all"
    echo "Branch parameter: $1"
    read -p "Are you sure you want to do this? (y/n) " double_check

    if [[ $double_check != 'y' ]]; then
        echo ""
        echo "...Maybe later."
        return
    fi

    __input_branch=$1
    gogo; grm $__input_branch &
    ghy; grm $__input_branch &
    glv; grm $__input_branch &
    gls; grm $__input_branch &
    gc7; grm $__input_branch &
    gc8; grm $__input_branch &
    gbh; grm $__input_branch &
    gtz; grm $__input_branch &
    gad; grm $__input_branch &
    gre; grm $__input_branch &
}
function _git_remove_local_branch_and_recreate_all() {
    echo "Function: _git_remove_local_branch_and_recreate_all"
    echo "Branch parameter: $1"
    read -p "Are you sure you want to do this? (y/n) " double_check

    if [[ $double_check != 'y' ]]; then
        echo ""
        echo "...Maybe later."
        return
    fi

    __input_branch=$1
    gogo; grm-re $__input_branch &
    ghy; grm-re $__input_branch &
    glv; grm-re $__input_branch &
    gls; grm-re $__input_branch &
    gc7; grm-re $__input_branch &
    gc8; grm-re $__input_branch &
    gbh; grm-re $__input_branch &
    gtz; grm-re $__input_branch &
    gad; grm-re $__input_branch &
    gre; grm-re $__input_branch &
}

function _git_remove_remote_branch_all() {
    echo "Function: _git_remove_remote_branch_all"
    echo "Branch parameter: $1"
    read -p "Are you sure you want to do this? (y/n) " double_check

    if [[ $double_check != 'y' ]]; then
        echo ""
        echo "...Maybe later."
        return
    fi

    __input_branch=$1

    gogo; grmr $__input_branch &
    ghy; grmr $__input_branch &
    glv; grmr $__input_branch &
    gls; grmr $__input_branch &
    gc7; grmr $__input_branch &
    gc8; grmr $__input_branch &
    gbh; grmr $__input_branch &
    gtz; grmr $__input_branch &
    gad; grmr $__input_branch &
    gre; grmr $__input_branch &
}
function _git_remove_remote_branch_and_recreate_all() {
    echo "Function: _git_remove_remote_branch_and_recreate_all"
    echo "Branch parameter: $1"
    read -p "Are you sure you want to do this? (y/n) " double_check

    if [[ $double_check != 'y' ]]; then
        echo ""
        echo "...Maybe later."
        return
    fi

    __input_branch=$1

    gogo; grmr-re $__input_branch &
    ghy; grmr-re $__input_branch &
    glv; grmr-re $__input_branch &
    gls; grmr-re $__input_branch &
    gc7; grmr-re $__input_branch &
    gc8; grmr-re $__input_branch &
    gbh; grmr-re $__input_branch &
    gtz; grmr-re $__input_branch &
    gad; grmr-re $__input_branch &
    gre; grmr-re $__input_branch &
}

function _git_remove_both_branch_all() {
    echo "Function: _git_remove_both_branch_all"
    echo "Branch parameter: $1"
    read -p "Are you sure you want to do this? (y/n) " double_check

    if [[ $double_check != 'y' ]]; then
        echo ""
        echo "...Maybe later."
        return
    fi

    __input_branch=$1

    gogo; grmF $__input_branch &
    ghy; grmF $__input_branch &
    glv; grmF $__input_branch &
    gls; grmF $__input_branch &
    gc7; grmF $__input_branch &
    gc8; grmF $__input_branch &
    gbh; grmF $__input_branch &
    gtz; grmF $__input_branch &
    gad; grmF $__input_branch &
    gre; grmF $__input_branch &
}

function _git_remove_both_branch_and_recreate_all() {
    echo "Function: _git_remove_both_branch_and_recreate_all"
    echo "Branch parameter: $1"
    read -p "Are you sure you want to do this? (y/n) " double_check

    if [[ $double_check != 'y' ]]; then
        echo ""
        echo "...Maybe later."
        return
    fi

    __input_branch=$1

    gogo; grmF-re $__input_branch &
    ghy; grmF-re $__input_branch &
    glv; grmF-re $__input_branch &
    gls; grmF-re $__input_branch &
    gc7; grmF-re $__input_branch &
    gc8; grmF-re $__input_branch &
    gbh; grmF-re $__input_branch &
    gtz; grmF-re $__input_branch &
    gad; grmF-re $__input_branch &
    gre; grmF-re $__input_branch &
}

function _greset_all_brand() {
    echo "Function: _greset_all_brand"
    echo "Branch parameter: $1"
    read -p "Are you sure you want to do this? (y/n) " double_check

    if [[ $double_check != 'y' ]]; then
        echo ""
        echo "...Maybe later."
        return
    fi

    gogo; git add :/; git reset --hard &
    ghy; git add :/; git reset --hard &
    glv; git add :/; git reset --hard &
    gls; git add :/; git reset --hard &
    gc7; git add :/; git reset --hard &
    gc8; git add :/; git reset --hard &
    gbh; git add :/; git reset --hard &
    gtz; git add :/; git reset --hard &
    gad; git add :/; git reset --hard &
    gre; git add :/; git reset --hard &
}

function _read_practice() {
    read -p "Are you sure you want to do this? (y/n) " double_check

    if [[ $double_check != 'y' ]]; then
        echo ""
        echo "...Maybe later."
        return
    fi

    echo ""
    echo "..Maybe later."
}

function _where_are_you() {
    dir=$(pwd);

    gogo;
    local __gogo_branch=`git branch 2> /dev/null | grep -e ^* | sed -E  s/^\\\\\*\ \(.+\)$/\\\\\1\/`

    ghy;
    local __ghy_branch=`git branch 2> /dev/null | grep -e ^* | sed -E  s/^\\\\\*\ \(.+\)$/\\\\\1\/`

    glv;
    local __glv_branch=`git branch 2> /dev/null | grep -e ^* | sed -E  s/^\\\\\*\ \(.+\)$/\\\\\1\/`

    gls;
    local __gls_branch=`git branch 2> /dev/null | grep -e ^* | sed -E  s/^\\\\\*\ \(.+\)$/\\\\\1\/`

    gc7;
    local __gc7_branch=`git branch 2> /dev/null | grep -e ^* | sed -E  s/^\\\\\*\ \(.+\)$/\\\\\1\/`

    gc8;
    local __gc8_branch=`git branch 2> /dev/null | grep -e ^* | sed -E  s/^\\\\\*\ \(.+\)$/\\\\\1\/`

    gbh;
    local __gbh_branch=`git branch 2> /dev/null | grep -e ^* | sed -E  s/^\\\\\*\ \(.+\)$/\\\\\1\/`

    gtz;
    local __gtz_branch=`git branch 2> /dev/null | grep -e ^* | sed -E  s/^\\\\\*\ \(.+\)$/\\\\\1\/`

    gad;
    local __gad_branch=`git branch 2> /dev/null | grep -e ^* | sed -E  s/^\\\\\*\ \(.+\)$/\\\\\1\/`

    gre;
    local __gre_branch=`git branch 2> /dev/null | grep -e ^* | sed -E  s/^\\\\\*\ \(.+\)$/\\\\\1\/`

    echo "base: " $__gogo_branch
    echo "hy: " $__ghy_branch
    echo "lv: " $__glv_branch
    echo "ls: " $__gls_branch
    echo "c7: " $__gc7_branch
    echo "c8: " $__gc8_branch
    echo "bh: " $__gbh_branch
    echo "tz: " $__gtz_branch
    echo "admin: " $__gad_branch
    echo "reseller: " $__gre_branch

    cd "$dir"
}

alias gbyat="cd  ~/go/src/gitlab.paradise-soft.com.tw/backend/yaitoo"
alias gbcom="cd ~/go/src/gitlab.paradise-soft.com.tw/glob/common"
alias gbuti="cd  ~/go/src/gitlab.paradise-soft.com.tw/glob/utils"

function _check_all_backend_repo_to() {
    dir=$(pwd)
    __input_branch=$1

    gbyat ; fo ; git ch $__input_branch ;

    gbcom ; fo ; git ch $__input_branch ;

    gbuti ; fo ; git ch $__input_branch ;

    cd "$dir"
}

function _show_color() {
    echo -e "${Black}Hello, Black${NC}";
    echo -e "${DarkGray}Hello, DarkGray${NC}";
    echo -e "${Red}Hello, Red${NC}";
    echo -e "${LightRed}Hello, LightRed${NC}";
    echo -e "${Green}Hello, Green${NC}";
    echo -e "${LightGreen}Hello, LightGreen${NC}";
    echo -e "${Orange}Hello, Orange${NC}";
    echo -e "${Yellow}Hello, Yellow${NC}";
    echo -e "${Blue}Hello, Blue${NC}";
    echo -e "${LightBlue}Hello, LightBlue${NC}";
    echo -e "${Purple}Hello, Purple${NC}";
    echo -e "${LightPurple}Hello, LightPurple${NC}";
    echo -e "${Cyan}Hello, Cyan${NC}";
    echo -e "${LightCyan}Hello, LightCyan${NC}";
    echo -e "${Light}Hello, Light${NC}";
    echo -e "${White}Hello, White${NC}";
    echo -e "${NC}Hello, NC${NC}"
}

# di = directory
# fi = file
# ln = symbolic link
# pi = fifo file
# so = socket file
# bd = block (buffered) special file
# cd = character (unbuffered) special file
# or = symbolic link pointing to a non-existent file (orphan)
# mi = non-existent file pointed to by a symbolic link (visible when you type ls -l)
# ex = file which is executable (ie. has ‘x’ set in permissions).
# *.xxx = 附檔名為 xxx 的檔案

# 0 黑
# 31 紅
# 32 綠
# 33 黃
# 34 藍
# 35 紫
# 36 淺藍
# 37 白
# 01 高亮度

LS_COLORS=$LS_COLORS:'di=1;36:ex=0;33';
export LS_COLORS

alias ll='ls -lh'
alias la='ls -lha'

# 讓 ls 和 grep 顯示有顏色
alias ls='ls -F -N --color=auto'
alias grep='grep --color=auto'

#didn't work at cygwin but git bash...
# export GIT_PS1_SHOWDIRTYSTATE=1           # '*'=unstaged, '+'=staged
# export GIT_PS1_SHOWUNTRACKEDFILES=1       # '%'=untracked
# export GIT_PS1_SHOWSTASHSTATE=1           # '$'=stashed

# Git under Cygwin:
# a) Install git from Cygwin setup.exe
# b) git config --global user.name "<username>"
# c) git config --global user.password "<password>"
# d) git config --global credential.helper store
# e) Get personal access token per https://help.github.com/articles/creating-an-access-token-for-command-line-use/
# f) git clone <project>; first time it'll ask for credentials, after that it will store them

# alias ruby='ls -al'
alias compass='/cygdrive/c/ruby/bin/compass.bat'