const { exec } = require('child_process')

const PROJECT_ID_MAP = {
  FRONTEND: '43',
}

const WHITE_LABEL_LIST =[
  'btse',
  'storybook',
  'paradise',
  'bitmarketsalpha',
  'bitmarkets',
  'b2z',
  'coinraja',
  'bitdee',
  'lmex',
  'interpay',
  'walletdemo',
  'exchangedemo',
  'noglewallet',
  'transexchange',
  'bullstreet',
  'cofiex',
  'btseag',
  'btseuab',
  'altex',
  'bestpay',
  'cryptomarket',
  'btsegi',
  'binoex',
  'nvx',
  'traiex',
  'autotrader'
]

const BASE_URL = 'https://gitlab01.oa.btse.io/btse/frontend/-/merge_requests/new'

function generateUrl(sourceBranch, { baseUrl = BASE_URL } = {}) {
  return `${baseUrl}?${generateQuery(sourceBranch)}`
}

function generateQuery(sourceBranch, { projectId = PROJECT_ID_MAP.FRONTEND, targetBranch = 'develop', title: originalTitle = null } = {}) {
  const title = originalTitle ?? branchNameToPrTitle(sourceBranch)

  const payload = {
    'merge_request[source_project_id]': projectId,
    'merge_request[source_branch]': sourceBranch,
    'merge_request[target_project_id]': projectId,
    'merge_request[target_branch]': targetBranch,
    'merge_request[description]': '掛上 draft 避免誤觸',
    'merge_request[assignee_ids][]': '397', // 這個是我自己
    'merge_request[title]': `Draft: ${title}` // 讓 PR 是 draft
  }

  return new URLSearchParams(payload).toString()
}

function branchNameToPrTitle(branchName) {
  const [, num, originalName] = branchName.match(/(PLAT-\d+)_(.+)/) || ['','','']

  const { keys, last } = (originalName || branchName).split('-').reduce((payload, str) => {
    switch (true) {
      case str === 'FE':
      case WHITE_LABEL_LIST.includes(str.toLocaleLowerCase()):
        payload.keys.push(str)
        break
      default:
        payload.last.push(str)
    }

    return payload
  }, { keys: [], last: [] })

  const jiraNum = num
  const keysText = keys.map(key => `[${key}]`)
  const titleText = last.join(' ')

  return `${jiraNum} ${keysText} ${titleText}`.replace(/\s+/, ' ')
}

// start here
;(function() {
  const [,,branchName] = process.argv

  if (branchName == null) return void console.log('branchName 不可為空')

  const prUrl = generateUrl(branchName)

  exec(`open '${prUrl}'`)
})()
