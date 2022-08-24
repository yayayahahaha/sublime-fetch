if (/Android/i.test(navigator.userAgent)) {
  var versions = function() {
    var u = navigator.userAgent,
      app = navigator.appVersion;
    var ua = navigator.userAgent.toLowerCase();

    return {
      line: u.indexOf('Line') > -1
    };
  }();
  if (versions.line) {
    /* 如果是用手機開line 的瀏覽器 */
  }
}