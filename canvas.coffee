canvas = null
c = null
w = this.innerWidth
h = this.innerHeight

class Snow
	constructor: ()->

	update: ()->
		
init = ()->
	# init

draw = ()->
	# draw

window.onload = ()->
	canvas = document.getElementById 'c'
	canvas.width = w
	canvas.height = h
	c = canvas.getContext '2d'

	c.strokeStyle = 'red'
	c.lineWidth = 10

window.onresize = ()->
	w = this.innerWidth
	h = this.innerHeight
	canvas.width = w
	canvas.height = h

window.requestAnimFrame = (callback)->
	window.setTimeout callback, 1000/60