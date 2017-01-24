		function load_images(source, callback) {
			var loadedImages = 0,
				numImages = 0;
			for (var key in source)
				numImages++;
			for (var key in source) {
				images[key] = new Image();
				images[key].onload = function() {
					if (++loadedImages >= numImages) {
						callback(images);
					}
				}
				images[key].src = source[key];
			}
		}