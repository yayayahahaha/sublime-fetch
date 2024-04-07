/**
 * @function forceDownload
 * @todo refactore and edge situation handle
 * @link https://stackoverflow.com/a/49886131
 * */
export function forceDownload(url, fileName) {
  var xhr = new XMLHttpRequest()
  xhr.open('GET', url, true)
  xhr.responseType = 'blob'
  xhr.onload = function () {
    var urlCreator = window.URL || window.webkitURL
    var imageUrl = urlCreator.createObjectURL(this.response)
    var tag = document.createElement('a')
    tag.href = imageUrl
    tag.download = fileName
    document.body.appendChild(tag)
    tag.click()
    document.body.removeChild(tag)
  }
  xhr.send()
}
