# CICD 的整體流程

## Frontend repo 那邊的 CI/CD

> 在 frontend repo 那邊目前的分支是 `flyc/test-pipeline`  

裡面寫好了 gitlab 的 cicd 腳本，會在打包出 lambda 這邊需要的 variables 後，  
來觸發這邊 `.gitlab-ci.yml` 裡面的腳本  
全部整體的具體流程如下:

到 `.gitlab-ci.yml` 的 `parallel build` 這個 stage (階段), 會開始比較不容易找到接下來的流程

其執行順序是:

1. 要執行的階段(stage)是 `parallel build`  

> `.gitlab-ci.yml`

2. `.parallel dev`, `.parallel staging` 和 `.parallel release` 這三個 job 裡有這個階段(stage)  

> `.gitlab-ci.whitelabel.config.yml`

3. `Staging` 這個階段(stage) 有 extend `.parallel staging`, 並且沒有寫自己的 `rules`, `rules` 會從 extend 的 job 來

> `.gitlab-ci.whitelabel.config.yml`

而 `.parallel staging` 裡面的 rules 有寫到 `- if: $WHITELABEL_NAME =~ /(Btse|Paradise|Lmex|Traiex) staging/`  
也就是如果是 `Btse staging`, `Paradise staging`, `Lmex staging` 或 `Traiex staging` 的話會執行  

> 這邊有個疑慮是，在這個 if 的前面，還有另外兩個 if:   
```
- if: $WHITELABEL_NAME == $RECIPE
  variables:
    FORCE_UPDATE: true

- if: $RECIPE != null || $CI_COMMIT_BRANCH != 'staging'
  when: never
```
看起來如果有透過 `New Pipeline` 傳入 `$RECIPE` + 有匹配到的話  
_如果_ 沒有因為第一個 if 符合就中止的話，  
整個 job 應該會被 `when: never` 擋住  

> 但是沒有，還是可以順利運行

4. 也就是說，到了這裡可以知道 Staging 這裡會去執行剛剛我們在找的 `parallel build`

5. `Staging` 裡面有寫一個像這樣的東西, 就是一個物件陣列, (key 是 `WHITELABEL_NAME`, `BUILD_SCRIPT` 那些)

```
parallel:
  matrix:
    - WHITELABEL_NAME: Walletdemo staging
      BUILD_SCRIPT: build-walletdemo-staging
      BUNDLE_DIR_NAME: walletdemo.btse.co
      ENV_URL: https://walletdemo.btse.co
      AWS_S3_BUCKET_NAME: walletdemo.btse.co
```

上面的那些 `if` 裡用來判斷的 $WHITELABEL_NAME 什麼的也是從這裡來的

6. `.parallel staging` 如果符合條件的話，會去執行 `trigger` `.gitlab-ci.build.pipeline.yml` 這裡的 stages

7. `.gitlab-ci.build.pipeline.yml` 這裡的 stages 非常多，但基本上就是 build + deploy + 清除 cache + lighthouse 等等

8. `.gitlab-ci.build.pipeline.yml` 裡面有寫到 include, 我們要去裡面找我們需要的階段(stage)

```
include:
  - local: .gitlab-ci.template.yml
```

我們先找 `build`  
在裡面可以看到 `.shell runner`, `.k8s config`, `.maintenance mode` 這三個 job 的 `stage` 是 `build`  
接著，再去找有哪些 job 有 extend 這些 job  
...會找到若干個，其中的 `build staging artifact` 的 `rules` 有符合規則, extend 的是 `.k8s config`   

>  所以在 gitlab 上可以看到 `build staging artifact` 的這個任務有被執行

9. 在 `build staging artifact` 裡的 `.k8s config` 的 script 如下

```
script:
  - yarn $BUILD_SCRIPT $OPTION_PARAMETERS
  - mv -f ./dist ./$BUNDLE_DIR_NAME
```

我們要調整的話就直接加在這裡吧

```
script:
  - echo '===== Build project ====='
  - yarn $BUILD_SCRIPT $OPTION_PARAMETERS
  - echo '===== Build export variables for lambda server and move them into dist ====='
  - ./build-lambda-variable.sh
  - echo "===== rename dist into $BUNDLE_DIR_NAME ====="
  - mv -f ./dist ./$BUNDLE_DIR_NAME
```

10. 打包完後，在 `.gitlab-ci.build.pipeline.yml` 的階段(stage) 裡，有這次添加的兩個階段  
目的是處理剛剛打包好的 variables 和呼叫 lambda repo 的 gitlab 腳本。  
具體調成ㄓ

> `stage-prepare_lambda_variable` 會打包好需要的 variables  
> > 具體流程請參考下方的 `其他` 區塊  

> `stage-trigger_lambda_pipeline` 會去發當前這個 repo 的 cicd  
> > 參數細節都在同一個 `gitlab-ci.build.pipeline.yml` 這個檔案裡

11. 直至這個階段， frontend 這個 repo 的腳本差不多就結束了

## Lambda-for-ssr repo 的 CI/CD

而在當前這個 lambda repo 的 gitlab cicd,  
CI 的時候會做的事情如下:

> `.gitlab-ci.yml` 裡面的 `job-build`

1. 收到從 frontend repo 傳來的 `$BUNDLE_DIR_NAME` 參數
2. 同時也會收到打包好的 variables 和 index.html 等等`檔案`
3. 將 `$BUNDLE_DIR_NAME` 這個參數傳給 `build-lambda-server-environment.js`, 會根據參數和檔案產出等等打包 server 的時候會用到的變數們

> 需要用到的變數是 `index-html-content.js`, `config-variables.js` 和 `i18n 相關的東西`

4. 用上面產出的變數 + 原本 server 的 code, 打包出可以運行的 lambda node server 並壓縮成 .zip

`CD`, 相較單純，就是送上 s3

> `.gitlab-ci.yml` 裡面的 `job-deploy`

## 想在本機模擬整個流程的話該怎麼做

1. 到 frontend repo
2. 切換到有新的打包流程的 branch, 當前是 `flyc/test-pipeline`
3. 在 package.json 找到自己想要 build 的 白牌的 script (e.g. `build-walletdemo-staging`)
4. 直接執行該腳本

```bash
# 以 staging 環境的 walletdemo 為例子

# 打包出 dist
yarn build-walletdemo-staging

# 打包出 export-variables
BUILD_SCRIPT=build-walletdemo-staging  ./build-lambda-variable.sh
```

5. 會打包出 `dist` 資料夾和另外一個叫 `export-variables` 的資料夾

6. 接著在 `.gitlab-ci.whitelabel.config.yml` 找到與上面 script 對應的 matrix

> 像是 job `Staging` 底下的 parallel 的 matrix, 這邊對應的是 `WHITELABEL_NAME: Walletdemo staging`

7. 從那個 matrix 裡找到的對應的 item 裡找到 `BUNDLE_DIR_NAME` 這個參數
8. 創一個 `BUNDLE_DIR_NAME` 名稱的資料夾，並把 `dist` 的**內容** 移進去, 裡面已經有了ㄜ `export-variables` 和 `i18n`  


```bash
mkdir $BUNDLE_DIR_NAME
mv -f ./dist ./$BUNDLE_DIR_NAME
```

最後產出來的結果會像是這樣

```bash
# 以 walletdemo.btse.co 為例子
walletdemo.btse.co/...(dist 裡面的其他檔案)
walletdemo.btse.co/index.html(dist 裡面的檔案)
walletdemo.btse.co/export-variables
walletdemo.btse.co/i18n (meta 還是會需要 i18n)
```

接著把整個 `$BUNDLE_DIR_NAME` 搬移到這個專案的根目錄  
執行把 `dist` 和 `export-variables` 變成 server 用的參數的腳本

```js
node build-lambda-server-environment.js --bundle-dir-name $BUNDLE_DIR_NAME
```

> 會產生 `index-html-content.js`, `config-variables.js` 和 `把傳進來的 i18n 資料夾直接變成寫死的檔案`

接著就可以開始 build server 的腳本，並將其打包成 `.zip`

```bash
# DIST_PATH: dist
# ZIP_FILE_NAME: render-server.zip
# ZIP_TARGET_PATH: '$DIST_PATH/$ZIP_FILE_NAME'
# ZIP_SOURCE_PATH: '$DIST_PATH/*'
yarn build
zip -j "$ZIP_TARGET_PATH" $ZIP_SOURCE_PATH
```

最後，要把打包好的東西放上 s3，  
然後通知 lambda 要從 s3 更新 lambda 的 code

```bash
aws s3 cp $ZIP_TARGET_PATH $S3_PATH
'aws lambda update-function-code
  --function-name staging-render
  --s3-bucket staging-render.btse.co
  --s3-key render-server.zip
  --region ap-northeast-1'
```

> 記得參考 README 上的 aws 權限設定

就可以去 lambda 的網址上看看了  
當前測試用的 lambda `staging-render`, 其網址是 `https://staging-render.btse.co/`

## 其他

### frontend 打包 lambda 所需參數的具體流程

在 frontend 那邊的 `vite.config.js` 裡會根據新傳入的 `BUILD_TARGET` 是不是 `lib` 來決定要不要打包成 variables,  
其內容有被封裝到 `isBuildingLibrary` 這個 function 裡,  
而內容要是什麼則是從 vite.config.js 裡的 defineConfig > build > lib 是不是 `undefined` 來決定的

```js
defineConfig: {
  build: {
    lib: buildToLib
  }
}
```

`buildToLib` 這個變數則是來自於 `bin/vite/buildToLib.js` 這個檔案  
裡面寫到了一個 `entry` 是 `lambda-server-needed-variables.js`

內容則相當單純

```js
import generalConfig from '@/brand/generalConfig.js'
export default { generalConfig }
```

`vite` 會根據 `buildToLib.js` 裡指定的 `entry` 作為 rollup 打包的 ROOT,  
而在這個 ROOT 裡就可以 export 出去我們需要的變數出去。

#### 💥💥💥 請注意 💥💥💥

> TL;DR 因為 frontend 寫法的關係，導致沒辦法靈活地自由 export 任一檔案，僅能 export 單純的設定檔等等

由於 frontend repo 有互相 import 了太多層級，所以 **並不是** 任何 function 或是 variables 都能被引用，  
很容易層層嵌套導致 import 了近乎整個專案進來  
也因為專案內有寫到很多 `window.xxx` 的這種僅在瀏覽器環境運行的 code,  
在純粹的 nodejs 專案內就會無法使用
