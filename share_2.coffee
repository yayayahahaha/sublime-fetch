# https://twitter.com/intent/tweet
# ?ref_src = twsrc%5Etfw
# &text = %20%20
# &tw_p = tweetbutton
# &url = https%3A%2F%2Ftwitter.com%2FFG_Fashionguide

# fashion guide share_log_php href
#http://active.fashionguide.com.tw/new/ajax/share_log.php

socialList = [
	'share-twitter'
]
type = null
device = null


window.onload = ()->
	twitterBtn = document.querySelector '.share-twitter'
	console.log twitterBtn

	twitterBtn.onclick = ()->
		console.log this.target

init = ()->
	twitterBtn = document.querySelectorAll 'a'
	console.log twitterBtn

shareTwitter = (shareText, shareUrl)->
	twitterArray = [
		"https://twitter.com/intent/tweet?",
		"ref_src", "twsrc%5Etfw",
		"&text", shareText,
		"&tw_p", "tweetbutton",
		"&url", encodeURIComponent shareUrl,
	]
	console.log twitterArray.join()

# if(navigator.userAgent.match("Firefox")){
# 	console.log("browser is Firefox");
# }
# else if(navigator.userAgent.match("MSIE")){
# 	console.log("browser is MSIE");
# }
# else if(navigator.userAgent.match("Opera")){
# 	console.log("browser is Opera");
# }
# else if(navigator.userAgent.match("Safari")){
# 	console.log("browser is Safari");
# }

# if( /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ) {

# }