const { exec } = require('child_process')

const WHITE_LABEL_LIST = [
  'btse',
  'altex',
  'autotrader',
  'b2z',
  'bestpay',
  'binoex',
  'bitkub',
  'bitmarkets',
  'bitmarketsalpha',
  'bitqik',
  'btseag',
  'btsegi',
  'btseuab',
  'bullstreet',
  'coinwise',
  'cryptomarket',
  'exchangedemo',
  'fedhabit',
  'interpay',
  'lmex',
  'nvx',
  'obot',
  'paradise',
  'pixbit',
  'testnet',
  'traiex',
  'transexchange',
  'walletdemo',
]

const BASE_URL_FN = (repo) => {
  return `https://gitlab01.oa.btse.io/${repo}/-/merge_requests/new`
}

function guessTargetBranch(repo) {
  switch (repo) {
    case 'frontend/btse-static-resource':
      return 'master'

    default:
      return 'develop'
  }
}

function generateUrl(sourceBranch, { baseUrl, repo } = {}) {
  return `${baseUrl}?${generateQuery(sourceBranch, { targetBranch: guessTargetBranch(repo) })}`
}

function generateQuery(sourceBranch, { targetBranch, title: originalTitle = null } = {}) {
  const title = originalTitle ?? branchNameToPrTitle(sourceBranch)

  const payload = {
    // 透過 git remote 取得 project 資訊
    // 'merge_request[source_project_id]': projectId,
    // 'merge_request[target_project_id]': projectId,

    'merge_request[source_branch]': sourceBranch,
    'merge_request[target_branch]': targetBranch,
    'merge_request[description]': '#### 背景\n\n\n#### 怎麼處理\n\n\n#### 其他\n掛上 draft 避免誤觸',
    'merge_request[assignee_ids][]': '397', // 這個是我自己
    'merge_request[title]': `Draft: ${title}`, // 讓 PR 是 draft
  }

  return new URLSearchParams(payload).toString()
}

function branchNameToPrTitle(branchName) {
  const [, num, originalName] = branchName.match(/(PLAT-\d+)_(.+)/) || ['', '', '']

  const { keys, last } = (originalName || branchName).split('-').reduce(
    (payload, str) => {
      switch (true) {
        case str === 'FE':
        case WHITE_LABEL_LIST.includes(str.toLocaleLowerCase()):
          payload.keys.push(str)
          break
        default:
          payload.last.push(str)
      }

      return payload
    },
    { keys: [], last: [] }
  )

  const jiraNum = num
  const keysText = keys.map((key) => `[${key}]`).join('')
  const titleText = last.join(' ')

  return `${jiraNum} ${keysText} ${titleText}`.replace(/\s+/, ' ')
}

// start here
;(function () {
  const [, , branchName, remoteInfo] = process.argv

  if (branchName == null) return void console.log('branchName 不可為空')

  const repo = remoteInfo.match(/.+:(.+)\./)[1]
  const baseUrl = BASE_URL_FN(repo)
  const prUrl = generateUrl(branchName, { baseUrl, repo })

  exec(`open '${prUrl}'`)
})()
