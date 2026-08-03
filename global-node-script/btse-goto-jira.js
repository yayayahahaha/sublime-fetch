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

function generateJiraUrl(branchName) {
  const [, num] = branchName.match(/(PLAT-\d+)[\D].+/) || ['', '', '']

  const jiraNum = num

  return `https://btse.atlassian.net/browse/${jiraNum}`
}

// start here
;(function () {
  const [, , branchName] = process.argv

  if (branchName == null) return void console.log('branchName 不可為空')

  exec(`open '${generateJiraUrl(branchName)}'`)
})()
