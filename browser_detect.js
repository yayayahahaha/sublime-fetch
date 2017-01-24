	if(navigator.userAgent.match("Firefox")){
		console.log("browser is Firefox");
	}
	else if(navigator.userAgent.match("MSIE")){
		console.log("browser is MSIE");
	}
	else if(navigator.userAgent.match("Opera")){
		console.log("browser is Opera");
	}
	else if(navigator.userAgent.match("Safari")){
		console.log("browser is Safari");
	}

	if( /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ) {
 // some code..
	}