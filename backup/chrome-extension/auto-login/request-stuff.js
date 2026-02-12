export class Response {
  constructor({ error, data } = {}) {
    this.error = error
    this.data = data
  }
}

function doFetch(url, config = {}) {
  return fetch(url, config)
    .then(async (res) => {
      let data = null
      let error = null

      try {
        if (res.ok) {
          data = await res.json()
        } else {
          error = await res.json() // Attempt to parse error as JSON
        }
      } catch (e) {
        // If parsing as JSON fails, try as text
        error = await res.text()
      }

      return new Response({ data, error })
    })
    .catch((e) => {
      // Catch network errors or other errors before the .then chain
      return new Response({ error: e.message || 'Network error' })
    })
}

export function get(url, ...other) {
  return doFetch(url, ...other)
}

export function post(url, params = null, headers = {}) {
  const body = params instanceof FormData ? params : typeof params === 'string' ? params : JSON.stringify(params)

  if (!console) {
    console.log('post 收到的參數們: ')
    console.log('\turl: ', url)
    console.log('\tbody: ', body)
    console.log('\theaders: ', headers)
  }

  return doFetch(url, { method: 'post', body, headers })
}
