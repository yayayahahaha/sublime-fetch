self.addEventListener("connect", function(e) {
    var port = e.ports[0];

    /* recieve from main.js */
    port.addEventListener("message", function(e) {

        /* sent to main.js */
        port.postMessage("hello, main.js");
    }, false);

    port.start();

}, false);