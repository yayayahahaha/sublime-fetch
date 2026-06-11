import { createI18n } from 'vue-i18n'

// !! 這個地方會被腳本取代，不要修改關鍵字!
// 關鍵字: __i18n_message_replace_this__
const messages = '__i18n_message_replace_this__'

export const i18n = (() => {
  const i18n = createI18n({
    locale: ['en', 'zh_TW'],

    allowComposition: true,

    // 這個東西會被腳本產生，詳情 build-lambda-server-environment.js
    messages,

    missingWarn: false, // suppress warning if translation is missing

    fallbackWarn: false, // suppress warning if fallback is required

    legacy: false,

    flatJson: true,

    messageResolver: (obj, path) => {
      let message = obj[path]

      if (!message) {
        message = path.split('.').reduce((accumulator, nextLayer) => {
          if (accumulator && typeof accumulator === 'object') {
            return accumulator[nextLayer]
          }

          return undefined
        }, obj)
      }

      return message
    }
  })

  i18n.t = i18n.global.t // Mapping reference

  return i18n
})()
