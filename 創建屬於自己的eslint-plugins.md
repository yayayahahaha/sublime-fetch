# 創建屬於自己的 eslint-plugins

> 當前的 version: `^8.29.0`

### 基礎建設

1. 創建一個新的資料夾，名稱可以隨便取，這邊選用 `custom-eslint-plugins`

2. 在這個資料夾裡面，創建另外一個資料夾，這個資料夾的名字會是你的 **plugin 的名字**  
   這邊使用 `you-shall-not-pass`

3. 在 `custom-eslint-plugins/you-shall-not-pass` 裡，透過 `npm init` 開啟一個新專案

```bash
npm init
```

專案名稱 **必須** 是 `eslint-plugin-` 開頭，這邊使用 `eslint-plugin-you-shall-not-pass`,  
創建出來的 `package.json` 預計會是這樣

```json
{
  "name": "eslint-plugin-you-shall-not-pass",
  "version": "1.0.0",
  "description": "you shall not pass",
  "main": "index.js",
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "author": "flyc",
  "license": "ISC"
}
```

在 `package.json` 同層級加上與內容的 `main` 對應的檔案: `index.js`,  
這個檔案會 export 出來一個 object, 裡面有 `rules`  
這個 `rules` 的 keys 就是當前這個 plugin 所擁有的 rules' name, 所以會是成這樣

```js
module.exports = {
  rules: {
    'my-rule-1': {
      /* ... */
    },
    'my-rule-2': {
      /* ... */
    },
    'my-rule-3': {
      /* ... */
    },
  },
}
```

接著，為了 demo 方便，先創個簡單的 rules 如下，  
這個 demo 會讓所有的 function call 都出現錯誤訊息。

```js
module.exports = {
  rules: {
    'my-rule-1': {
      create: function (context) {
        return {
          CallExpression(node) {
            context.report({ node, message: '這裡是錯誤訊息' })
          },
        }
      },
    },
  },
}
```

創建完畢後，需要把這個 eslint plugin 安裝到原專案裡  
請留意方才寫到的資料夾名稱等等

```json
// package.json
{
  // ...
  "devDependencies": {
    // ...
    "eslint-plugin-you-shall-not-pass": "file:custom-eslint-plugins/you-shall-not-pass"
    // ...
  }
  // ...
}
```

接著，要到 `.eslintrc.js` 這裡告訴 eslint 說要安裝的 plugin 和要設定的 rules

```js
// .eslintrc.js
{
  // ...
  plugins: ['import', 'you-shall-not-pass'],
  rules: {
    'you-shall-not-pass/my-rule-1': 2,
  },
  // ...
}
```

最後，重新執行 npm packages 的安裝後，重啟 IDE 的 eslint extension 即可

### 調整

> 這邊僅會介紹比較常用的部分，  
> 詳細文件請參考[官網](https://eslint.org/docs/v8.x/extend/custom-rule-tutorial#the-custom-rule)
