function countTextLength(input, size, family) {
  input = input ? input : '';
  size = size ? size : '16px';
  family = family ? family : ' sans-serif';

  var c = document.createElement('canvas');
  var ctx = c.getContext('2d');
  ctx.font = size + 'px ' + family;
  var txt = input;
  ctx.fillText('width:' + ctx.measureText(txt).width, 10, 50);
  return ctx.measureText(txt).width;
}