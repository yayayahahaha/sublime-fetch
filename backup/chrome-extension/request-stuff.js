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

export function get(url) {
  return doFetch(url)
}

export function post(url, params = null, headers = {}) {
  const body = params instanceof FormData ? params : typeof params === 'string' ? params : JSON.stringify(params)

  return doFetch(url, { method: 'post', body, headers })
}
