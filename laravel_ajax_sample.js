$.ajax({
	url: window.location.origin + '/frontApi',
	method: "post",
	headers: {
		'X-CSRF-TOKEN': $('meta[name="csrf-token"]').attr('content')
	},
	data: {
		accessTokenChecker: currentAccessToken, //用來確認底下input 傳入的fb_id 是否為本人授權用
		key: "1", //對應到FrontController.php 裡的第53 行開始
		input: {
			key1: "value1",
			key2: "value2",
			fb_id: res.id, //如果有accessTokenChecker，這兩個都要
			fb_name: res.name, //如果有accessTokenChecker，這兩個都要
			access_token: currentAccessToken
		}
	}
}).done(function(res) {
	console.log("done\n", res);
}).fail(function(res) {
	console.log("fail\n", res);
});

composer create - project laravel / laravel beauty.fashionguide.com.tw "5.3.*"--prefer - dist