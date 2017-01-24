/*

logAjax() 吃兩個參數
第一個參數是 api 的尾巴
	有兩種
	"keyword" 或 "popular_article"
	如果沒有輸入或輸入錯誤皆會有log error, 

第二個參數是 api 的 input, 格式是json
	會依照第一個參數決定其key 值
	第一個參數如果是 keyword 格式如下:
		{
			"key_word": "使用者搜尋的關鍵字",
			"member_id": "member_id",
			"uid": "uid",
			"clicked_url": "點擊的url"
		}
	第二個參數如果是 popular_article 格式如下:
		{
			"title": "標題",
			"member_id": 0,
			"uid": "0",
			"type": "enter" / "collection" / "response", //這個是使用者的行為模式，依序為 進入頁面, 收藏, 回應
			"url": "https://xxx.xxx.xxx" //當前頁面的url
		}

*/

function logAjax(url, inputData) {
	if (arguments.length != 2) {
		console.error("只能輸入兩個參數");
		return;
	}

	if (url == "keyword") {
		console.log(inputData.key_word);
		inputData.key_word = inputData.key_word ? inputData.key_word : "預設關鍵字";
		if (!inputData.key_word) {
			console.error("第二個參數格式錯誤");
			return
		};
		inputData.member_id = inputData.member_id ? inputData.member_id : 0;
		inputData.uid = inputData.uid ? inputData.uid : "0";
		inputData.clicked_url = inputData.clicked_url ? inputData.clicked_url : window.location.href;
	} else if (url == "popular_article") {
		inputData.title = inputData.title ? inputData.title : document.querySelector("title").innerHTML;
		if (!inputData.title) {
			console.error("第二個參數格式錯誤");
			return
		};
		inputData.member_id = inputData.member_id ? inputData.member_id : 0;
		inputData.uid = inputData.uid ? inputData.uid : "0";
		inputData.type = inputData.type ? inputData.type : "enter";
		inputData.url = inputData.url ? inputData.url : window.location.href;
	} else {
		console.error("第一個參數請輸入 keyword 或 popular_article");
		return
	}

	$.ajax({
			url: '//test-dashboard.fashionguide.com.tw/api/' + url,
			type: 'post',
			data: inputData,
		})
		.done(function(res) {
			console.log("done");
			console.log(res);
		})
		.fail(function(res) {
			console.log("fail");
			console.log(res);
		});
}