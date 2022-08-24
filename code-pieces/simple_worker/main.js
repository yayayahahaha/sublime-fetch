document.addEventListener("DOMContentLoaded", function() {
    /* worker initialize */
    worker = new SharedWorker("worker.js");

    /* recieve from worker.js */
    worker.port.addEventListener("message", function(e) {
        that.room = e.data;
    }, false);

    /* send to worker.js */
    worker.port.postMessage("hello");

    worker.port.start();
});