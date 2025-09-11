function setMessage(value, { type = 'info' } = {}) {
  const message = window.document.querySelector('#message')
  message.classList = ['message']

  message.innerHTML = value

  switch (type) {
    case 'error':
      message.classList.add('error')
      break
  }
}

async function copyString(copiedText) {
  return navigator.clipboard.writeText(copiedText)
}

if (typeof window !== 'undefined') {
  window.setMessage = setMessage
}
if (typeof window !== 'undefined') {
  window.copyString = copyString
}
