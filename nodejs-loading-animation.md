# Nodejs Loading Animation

> \ | / -

直接上 code

```javascript
setTimeout(() => process.stdout.write(`\r1`), 1 * 300)
setTimeout(() => process.stdout.write(`\r2`), 2 * 300)
setTimeout(() => process.stdout.write(`\r3`), 3 * 300)
setTimeout(() => process.stdout.write(`\r4`), 4 * 300)
setTimeout(() => process.stdout.write(`\r5`), 5 * 300)
```

用 `process.stdout.write` 搭配 `\r` 開頭的訊息的話會取代當前那行  
藉此可以做到 loading 的動畫
