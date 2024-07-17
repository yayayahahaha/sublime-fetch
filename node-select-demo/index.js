// https://github.com/SBoudrias/Inquirer.js/tree/main/packages/confirm
import confirm from '@inquirer/confirm'
const confirmAnswer = await confirm({ message: 'Continue?', default: false })
console.log(confirmAnswer)

// https://github.com/SBoudrias/Inquirer.js/tree/main/packages/input
import { input } from '@inquirer/prompts'
const inputAnswer = await input({
  message: '寫點什麼吧',
  default: '我是預設值',
  required: true,
})
console.log(inputAnswer)

// https://github.com/SBoudrias/Inquirer.js/tree/main/packages/select
import select, { Separator } from '@inquirer/select'
const selectAnswer = await select({
  message: '用選的吧',
  choices: [
    {
      name: '我是選項 1',
      value: 'option-1',
      description: '沒想到居然還可以選描述',
    },
    {
      name: '我是選項 2',
      value: 'option-2',
      description: '現在已經不那麼驚訝了',
    },
    new Separator(),
    {
      name: '我是選項 3',
      value: 'option-3',
      description: '沒想到還可以分開放',
    },
    {
      name: '我是選項 4',
      value: 'option-4',
      description: '沒辦法選喔',
      disabled: true,
    },
  ],
})
console.log(selectAnswer)

// https://github.com/SBoudrias/Inquirer.js/tree/main/packages/checkbox
import checkbox from '@inquirer/checkbox'
const checkboxAnswer = await checkbox({
  message: 'Select a package manager',
  choices: [
    {
      name: 'Ruby',
      value: 'ruby',
    },
    {
      name: 'Weiss',
      value: 'weiss',
    },
    new Separator(),
    {
      name: 'Blake',
      value: 'blake',
      disabled: true,
    },
    {
      name: 'Yang',
      value: 'yang',
      disabled: '(pnpm is not available)',
    },
  ],
})
console.log(checkboxAnswer)

// https://github.com/SBoudrias/Inquirer.js/tree/main/packages/rawlist
import rawlist from '@inquirer/rawlist'
const rawListAnswer = await rawlist({
  message: 'Select a package manager',
  choices: [
    {
      name: 'npm',
      value: 'npm',
    },
    {
      name: 'yarn',
      value: 'yarn',
    },
    {
      name: 'pnpm',
      value: 'pnpm',
    },
  ],
})
console.log(rawListAnswer)

// https://github.com/SBoudrias/Inquirer.js/tree/main/packages/expand
import expand from '@inquirer/expand'
const expandAnswer = await expand({
  message: 'Conflict on file.js',
  default: 'y',
  choices: [
    {
      key: 'y',
      name: 'Overwrite',
      value: 'overwrite',
    },
    {
      key: 'a',
      name: 'Overwrite this one and all next',
      value: 'overwrite_all',
    },
    {
      key: 'd',
      name: 'Show diff',
      value: 'diff',
    },
    {
      key: 'x',
      name: 'Abort',
      value: 'abort',
    },
  ],
})
console.log(expandAnswer)
