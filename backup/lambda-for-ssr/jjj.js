fetch('https://staging.btse.co/en/ref', {
  headers: {
    // 'User-Agent': 'Googlebot/2.1'
  }
})
  .then(r => r.text())
  .then(console.log)
