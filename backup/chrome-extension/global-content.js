;(function () {
  // TODO(flyc): 先用直接複製過來的方式處理
  class EncodeDecode {
    static spliceLength = 10

    static genRegexp(spliceLength) {
      return new RegExp(`^.{${spliceLength}}`)
    }

    static replaceReverse(str, spliceLength) {
      return str.replace(EncodeDecode.genRegexp(spliceLength), (match) => {
        return match.split('').reverse().join('')
      })
    }

    static encode(payload, spliceLength = EncodeDecode.spliceLength) {
      return EncodeDecode.replaceReverse(btoa(JSON.stringify(payload)), spliceLength)
    }

    static decode(payload, spliceLength = EncodeDecode.spliceLength) {
      return JSON.parse(atob(EncodeDecode.replaceReverse(payload, spliceLength)))
    }
  }

  const EXAMPLE_HOST = 'example.com'

  if (window.location.host !== EXAMPLE_HOST) return

  const { _ } = Object.fromEntries(new URLSearchParams(new URL(window.location.href).search))
  const { token, url } = EncodeDecode.decode(EncodeDecode.decode(_, 5), 10)

  if (token == null) return
  if (url == null) return

  chrome.runtime.sendMessage({
    action: 'openTabWithToken',
    token: token,
    url,
  })
})()
