var canvas = document.getElementById('c');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

if (canvas.getContext) {
	var c = canvas.getContext('2d'),
		w = canvas.width,
		h = canvas.height;

	c.strokeStyle = 'red';
	c.fillStyle = 'white';
	c.lineWidth = 5;
}