function fbShare(appId, fbLink, redirect) {
	var fbArray = [
		'https://m.facebook.com/dialog/feed?app_id=',
		appId,
		'&link=',
		encodeURIComponent(fbLink),
		'&redirect_uri=',
		encodeURIComponent(redirectUri),
	];

	window.location.href = fbArray.join();
}

function lineShare(title, lineLink) {
	var lineArray = ['http://line.me/R/msg/text/?',
		encodeURI(title),
		'%0D%0A',
		encodeURI(lineLink)
	];

	window.location.href = lineArray.join();
}