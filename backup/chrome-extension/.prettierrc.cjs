// 文件:
// https://prettier.io/docs/en/configuration.html
// https://prettier.io/docs/en/options.html

// 推薦放在家目錄下，這是還蠻預設的東西
// 如果專案內有 .prettierrc.js 的話，會以專案內的設定為主
// *不會堆疊* , 意思是如果 $HOME 的設定了 singleQuote 是 true, 但 $PROJECT 沒有設定的話
// singleQuote 在執行時的設定會是預設的 false

module.exports = {
  /**
   * @description object 結尾的東西要不要加上 ","
   * @document https://prettier.io/docs/en/options.html#trailing-commas
   * */
  trailingComma: 'es5',

  /**
   * @description tab 的 space 個數，基本上會跟著 sublime text 的設定走
   * @document https://prettier.io/docs/en/options.html#tab-width
   * */
  tabWidth: 2,

  /**
   * @description 要不要加 ";"
   * @document https://prettier.io/docs/en/options.html#semicolons
   * */
  semi: false,

  /**
   * @description 要用單引號還是雙引號
   * @document https://prettier.io/docs/en/options.html#quotes
   * */
  singleQuote: true,

  /**
   * @description 多少長度要換行
   * @document https://prettier.io/docs/en/options.html#print-width
   * */
  printWidth: 120,
}
