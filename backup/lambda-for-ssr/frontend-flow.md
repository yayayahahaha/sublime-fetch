# Frontend Flow

> 2024/06  
> https://staging-render.btse.co

### 開始之前

請先參考 [README](./README.md#_6) 裡的 aws profile 設定方式設定好本地的 profile  
這樣在「上傳檔案到 aws 上」的步驟時才會有權限

### 部署方式

```bash
yarn
yarn go # yarn build && yarn upload
```

會把 `index.js` 與相關 packages 全都打包到 `dist` 後，  
透過 aws 的 command 將 code 部署到 lambda 上

### 開發方式

調整 `index.js` -> 部署上去檢查

> 還在找比較方便的本地開發方式  
> 像是把 frontend repo 的東西打包好後在本地啟動 serverless 的 server 模擬 lambda 等
