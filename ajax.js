	// ajax testing part
	$.ajax({
		type: "post",
		url: "*.json",
		dataType: "text",
		success: function(result,status) {
			console.log("The length of json file: "+JSON.parse(result).length);
			console.log(status);
		},
		error: function(xhr, status, error) {
			console.log("Status: " + status);
			console.log("Error: " + error);
			console.log("xhr: " + xhr.readyState);
		},
		statusCode: {
			404: function() {
				console.log("page not found");
			}
		}
	});