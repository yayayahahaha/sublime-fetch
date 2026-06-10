import configVariables from './config-variables.js' // 會由 build-lambda-server-environment.js 產生
const USER_AGENT_KEY = 'user-agent'
export const variables = configVariables

/**
 * @function isHuman
 * @returns {boolean}
 *
 * @TODO 根據 user-agent 判斷是不是人類
 * */
export function isHuman(req, fake = null) {
  if (fake != null) return fake

  // req.headers[USER_AGENT_KEY]
  return true
}

/**
 * @function showAllHeaders
 * @param {object} req - express req instance
 * @returns {string} json format with `<pre></pre>`
 * */
export function showAllHeaders(req) {
  let data = Object.keys(req)
    .map(key => {
      try {
        JSON.stringify(req[key], null, 2)
        return { [key]: req[key] }
      } catch {
        return { [key]: 'cannot stringify' }
      }
    })
    .reduce((map, obj) => ({ ...map, ...obj }), {})
  data = {
    headers: req.headers,
    ...data
  }
  const str = JSON.stringify(data, null, 2)

  return `<pre>${str}</pre>`
}

/**
 * @function createElementFromSelector
 * @param {string} tag
 * @param {string} selector - e.g. #my-id.style-1.style-2[some1="attr1"][some2="attr2"]
 * @returns {string} XML string
 * @example
 * // return <div id="my-id" class="style" name="hello">some-content</div>
 * createElementFromSelector('div', '#my-id.style[name="hello"]{some-content}')
 * */
export function createElementFromSelector(tag = 'div', selector) {
  // ID
  const idMatch = selector.match(/#([\w-]+)/)
  const idStr = idMatch == null ? '' : `id="${idMatch[1]}"`

  // 所有 class
  const classMatches = selector.match(/\.([\w-]+)/g)
  const classStr =
    classMatches == null
      ? ''
      : `class="${classMatches.map(dotClass => dotClass.slice(1)).join(' ')}"`

  // 所有屬性
  const attrMatches = [...selector.matchAll(/\[([\w-]+)="([^"]+)"\]/g)]
  const attrStr = attrMatches
    .map(match => `${match[1]}="${match[2]}"`)
    .join(' ')

  // 內部文本內容
  const contentMatch = selector.match(/\{([^}]+)\}/)
  const content = contentMatch == null ? '' : contentMatch[1]

  const all = [idStr, classStr, attrStr].filter(Boolean).join(' ')

  return `<${tag} ${all.trim()}>${content}</${tag}>`
}

// 這個檔案是 build-lambda-server-environment.js 的腳本執行出來才有的
import { i18n } from './i18n-setup.js'
export function $t(...params) {
  return i18n.global.t(...params)
}
