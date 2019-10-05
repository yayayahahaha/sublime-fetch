function cloneObject(obj) {
  if (null === obj || 'object' != typeof obj) {
    console.log('input is not an object');
    return obj;
  }
  var copy = obj.constructor();
  for (var attr in obj) {
    if (obj.hasOwnProperty(attr)) copy[attr] = obj[attr];
  }
  return copy;
}