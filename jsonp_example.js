$.ajax({
  url: 'https://example.com/?callback=callback',
  dataType: 'JSONP',
  jsonpCallback: 'callback',
  type: 'GET',
  success: function(data) {
    console.log(data);
  }
});
/*
server端要回傳callbackName(js code) 此種形式的資料
callback 可自行命名，要在get 的網址列加上?callback=callbackName 此參數

其他跨域請求方式:
CORS:
https://blog.toright.com/posts/3205/%E5%AF%A6%E4%BD%9C-cross-origin-resource-sharing-cros-%E8%A7%A3%E6%B1%BA-ajax-%E7%99%BC%E9%80%81%E8%B7%A8%E7%B6%B2%E5%9F%9F%E5%AD%98%E5%8F%96-request.html
*/