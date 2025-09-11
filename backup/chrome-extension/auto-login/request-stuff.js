export class Response {
  constructor({ error, data } = {}) {
    this.error = error
    this.data = data
  }
}

function doFetch(url, config = {}) {
  return fetch(url, config)
    .then((res) => {
      const resClone = res.clone()
      try {
        if (res.ok) return Promise.all([res.json(), null])
        return Promise.all([null, res.json()])
      } catch {
        return Promise.all([null, resClone.text()])
      }
    })
    .then((data) => {
      return new Response({ data: data[0], error: data[1] })
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
