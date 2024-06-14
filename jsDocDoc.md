# JsDoc Doc

> More and more and more doc

### 直接從場景舉例

#### 基本款

```js
/**
 * @function sayHi
 * @param {string} word - 這是一個詞
 * @param {boolean} [maybe] - 不一定要傳
 * @param {number} [fallback=123] - 不傳會有預設值, 但現在 lsp 是壞的 https://github.com/microsoft/TypeScript/issues/16665
 * @returns {string} - 直接回傳一個詞
 * @description 更多更多解釋 https://jsdoc.app/tags-param
 * */
function sayHi(word, maybe, fallback) {
  if (maybe) console.log('maybe')
  return word + fallback
}
```

#### 稍微複雜些

```js
/**
 * @function moreAndMore
 * @param {Promise<string|Error>} res - promise resolve string
 * @param {String[]} stringList - string array
 * @param {Array<number>} numberList - number array
 * @param {Array<number|string>} numberOrStringList - number or string array
 * @returns {Promise<string>}
 * */

function moreAndMore(res, stringList, numberList, numberOrStringList) {
  return Promise.all([res, stringList, numberList, numberOrStringList])
}
```

#### 物件相關

```js
/**
 * @typedef {object} MyObject
 * @property {string} hello
 * @property {number} world
 * */

/**
 * @function sayObject
 * @param {object} obj - just object
 * @param {{ name: string, age?: number[] }} human - with property
 * @param {object} com - com root
 * @param {string} com.word - com word description
 * @param {number} com.count - com count description
 * @param {MyObject} myObject - custom object
 * @returns {{ obj: obj, human: human, com: com, nyObject: MyObject }}
 * */

function sayObject(obj, human, com, MyObject) {
  return { obj, human, com, myObject: MyObject }
}
```

#### `@type` vs `@typedef`

```js
// @type 用於告訴其他人下面這個變數是什麼格式
/** @type number[] */
const numberList = [1, 2, 3, 4, 5]

// @typedef 用於創造一個新的格式，讓其他人可以用這個格式
/** @typedef {Promise<string>} ResolveString */
/** @type ResolveString */
const myType = Promise.resolve('hello world')
```

#### 限定傳入 function 的參數只能是定義好的某些數值

兩種做法，一種是寫死、但定義的變數本身可以靈活定義;  
另一種是不寫死、但定義的變數本身就只能透過自動判斷

##### 寫死

```js
/** @typedef {string} StatusMsg */

/**
 * @typedef {Object} StatusItem
 * @property {boolean} finisehd - finisehd 的描述
 * @property {boolean} ok - ok 的描述
 * @property {StatusMsg} msg - msg 的描述
 * */

/** @typedef {'STATUS_SUCCESS'|'STATUS_ERROR'|'STATUS_PENDING'} TypeKey */
/** @type {Record<TypeKey, StatusItem>} */
const statusMaps = {
  STATUS_SUCCESS: {
    finished: true,
    ok: true,
    msg: 'job success',
  },

  STATUS_ERROR: {
    finished: true,
    ok: false,
    msg: 'job error',
  },

  STATUS_PENDING: {
    finished: false,
    ok: false,
    msg: 'job pending',
  },
}
```

上面的 `TypeKey` 是寫死的，所以如果更新了 `statusMap` 的話就得同步更新上面的 `TypeKey`  
不過也因此可以透過 `@type` 去定義 `statusMap` 的 type 是一個由 `TypeKey` 作為屬性、 value 是 `StatusItem` 的 Object

> `Record` 用於表示如果 object 的 keys 是某些固定的值的時候使用。  
> 如果不是固定的值的話可以寫成 `Object<string, StatusItem>`  
> 或是寫成 {{}} 的方式:
>
> ```js
> /** @type {{ customKey1: StatusItem, customKey2: StatusItem }} */
> ```

##### 不寫死

```js
const colorMap = {
  red: 123,
  blue: 456,
  orange: 789,
}

/** @typedef {keyof typeof colorMap} ColorKey */
/** @type {Record<ColorKey, string>} */
const object = {
  red: 'apple',
  blue: 'what',
  orange: 'just orange',
}
```

好處是只需維護 `colorMap` 的 code,  
但如果透過 `@type` 去描述 `colorMap` 的話，  
用 keyof typeof 取得的就會變成 `string|number|symbol` 了

##### keyof typeof 是什麼意思

以程式語言的方式來說是這樣:

```js
const result = keyof(typeof variable)
```

也就是把 `typeof variable` 的結果傳到 `keyof` 裡

**typeof**

會回傳後面變數的 `type`

舉例:

```js
/** @typedef {string} UserIdType */
/** @type UserIdType */
const userId = 'hello world'

/** @typedef {typeof userId} ClubMemberId */

/** @type Array<ClubMemberId>  */
const clubMemberIdList = ['a', 'b', 'c']
```

當我們需要創建一個叫做 `ClubMemberId` 的 `type` 的時候，  
透過 `@typedef {typeof userId} ClubMemberId` 我們就可以在不用去查看 userId 到底是什麼 type 的情況下直接和 `userId` 的 `type` 保持一致  
不用兩邊都去寫 `string`

**keyof**

有點類似 javascript 的 `Object.keys()`, 會把宣告好的 type 的 key 取出來變成一個 array, 然後就會變成`聯合字面量類型`, 也就一堆字串展開的樣子

如果把這個 `聯合字面量類型` 放到 `@typedef` 裡，就會變成限制只能傳入這些參數的寫法，在 vscode 上也會出現自動補全。

**keyof typeof**

綜合以上，既然我們最後需要的是 `keyof` 轉換出來的、讓使用者可以自動補全的清單，所以 function 最外層就會是 `keyof`;

接著，  
雖然會自動判斷，但 `keyof` 吃的參數其實是 `type`, 為此，我們就需要先透過 `typeof` 把 `variable` 的 `type` 給拿出來  
所以最後就變成了 `/** @typedef {keyof typeof variableName} NewType */`

> reference: https://juejin.cn/post/7023238396931735583?source=post_page-----92fb5566b9e6--------------------------------

#### Record

用於更加詳細地描述 object 的屬性的時候使用

```js
/**
 * @typedef {object} Member
 * @property {string} id
 * @property {string} name
 * @property {number} age
 * */

/**
 * @type {Record<Member['id'], Member>}
 * */
const memberMap = {}
```

當然也可以直接使用 `/** @type {Object<string, Member>} */`  
但在語意上就會不確定 object 的 key 會是 Member 的 id

#### import

直接上範例比較快

```js
/**
 * @function callMe
 * @param {import('@/types/index.js').Member} member
 * */
function callMe(member) {
  const { id, name } = member
  return `${id}: ${name}`
}
```

> reference: https://stackoverflow.com/questions/75450486/jsdoc-object-with-value-props-as-key
