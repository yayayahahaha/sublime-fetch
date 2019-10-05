var another = {
  getLocalStorage: function() {
    var inputArray = arguments,
      value,
      key,
      returnObject = {};
    switch (inputArray.length) {
      case 0:
        for (key in localStorage) {
          value = localStorage.getItem(key);
          try {
            value = JSON.parse(value);
          } catch (e) {}
          returnObject[key] = value;
        }
        return returnObject;
      case 1:
        key = inputArray[0];
        if (key instanceof Array) {
          var array = key.slice();
          for (var i = 0; i < array.length; i++) {
            key = array[i];
            value = localStorage.getItem(key);
            try {
              value = JSON.parse(value);
            } catch (e) {}
            returnObject[key] = value;
          }
          return returnObject;
        } else if (typeof key !== 'object') {
          value = localStorage.getItem(key);
          try {
            value = JSON.parse(value);
          } catch (e) {}
          return value;
        } else {
          console.warn('please input (key, key,...) or ([key1, key2, key3...]) as params');
        }
        break;
      default:
        for (var j = 0; j < inputArray.length; j++) {
          key = inputArray[j];
          value = localStorage.getItem(key);
          try {
            value = JSON.parse(value);
          } catch (e) {}
          returnObject[key] = value;
        }
        return returnObject;
    }
    return false;
  },
  setLocalStorage: function() {
    var inputArray = arguments,
      obj,
      key,
      value;
    switch (inputArray.length) {
      case 0:
        console.warn('please input (key, value) or ({key1: vlaue1, key2: value2...}) as params');
        break;
      case 1:
        obj = arguments[0];
        if (typeof obj === 'object' && !(obj instanceof Array)) {
          for (key in obj) {
            value = obj[key];
            if (typeof value === 'object') {
              value = JSON.stringify(value);
            }
            try {
              localStorage.removeItem(key);
              localStorage.setItem(key, value);
            } catch (e) {
              console.log(e);
              return false;
            }
          }
          return true;
        } else {
          console.warn('please input (key, value) or ({key1: vlaue1, key2: value2...}) as params');
        }
        break;
      case 2:
        key = inputArray[0];
        value = inputArray[1];
        if (typeof key !== 'object') {
          if (typeof value === 'object') {
            value = JSON.stringify(value);
          }
          try {
            localStorage.removeItem(key);
            localStorage.setItem(key, value);
            return true;
          } catch (e) {
            console.log(e);
            return false;
          }
        } else {
          console.warn('the key can\'t be an object.');
        }
        break;
      default:
        console.warn('please input (key, value) or ({key1: vlaue1, key2: value2...}) as params');
        break;
    }
    return false;
  }
};