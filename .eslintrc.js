// 這個設定檔是最基本的
// 基本上是給SublimeText3 看的
// 每個專案裡面會有自己的.eslintrc 檔案
// 所以在SublimeText3 上的lint 可以透過這種迭代的方式堆疊設定檔

module.exports = {
  root: true,
  env: {
    browser: true,
    es6: true,
    node: true
  },
  extends: [],
  parserOptions: {
    parser: 'babel-eslint'
  },
  plugins: [
    'vue'
  ],
  rules: {
    semi: ['error', 'always'],
    'no-param-reassign': ['error', {
      props: false
    }],
    quotes: ['error', 'single'],
    'comma-dangle': ['error', 'only-multiline'],
    'import/extensions': 'off',
    'no-shadow': 'off',
    'linebreak-style': 'off'
  }
}