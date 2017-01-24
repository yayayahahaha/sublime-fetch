function param(object) {
    var encodedString = '';
    for (var prop in object) {
        if (object.hasOwnProperty(prop)) {
            if (encodedString.length > 0) {
                encodedString += '&';
            }
            encodedString += encodeURI(prop + '=' + object[prop]);
        }
    }
    return encodedString;
}

function fgAjax(object) {
    object.method = object.method || "POST";

    var xhttp = new XMLHttpRequest();
    xhttp.onreadystatechange = function() {
        if (this.readyState == 4 && this.status == 200) {
            object.callbackSuccess(this.responseText);
        } else {
            if (!object.callbackError) {
                console.log("Error: " + this.responseText);
            } else {
                object.callbackError();
            }
        }
    };

    xhttp.open(object.method, object.url, true);
    xhttp.send(param(object.input));
}