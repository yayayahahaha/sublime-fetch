fetch('http://localhost:9999/login', {
  headers: {
    'content-type': 'application/json',
  },
  method: 'post',
  body: JSON.stringify({
    // email: 'fc@mailto.plus',
    email: 'flyc.chung@btse.com',
    brandName: null,
    // brandName: 'lmex',
    password: '!QAZ1qaz',
    secretCode2Fa: '4IEPN4HOPRIMWHXB',
  }),
})
  .then((r) => r.text())
  .then(console.log)
