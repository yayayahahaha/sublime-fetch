(function(d, s, id) {
  var js, fjs = d.getElementsByTagName(s)[0];
  if (d.getElementById(id));
  js = d.createElement(s);
  js.id = id;
  js.src = 'https://code.jquery.com/jquery-3.1.1.min.js';
  fjs.parentNode.insertBefore(js, fjs);
}(document, 'script', 'facebook-jssdk'));