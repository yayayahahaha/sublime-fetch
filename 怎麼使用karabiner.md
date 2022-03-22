## 怎麼使用 karabiner

> 用於重新綁定自己鍵盤的配置使用

網站: https://karabiner-elements.pqrs.org/

> 請注意! 由於外接鍵盤的 fn 按鍵通常會在組合按鍵使用前都不發送訊號  
> 所以 **"無法"** 透過 karabiner 修改 fn 的鍵位；  
> 但是， Mac 鍵盤上的 `fn` 是可以替換的  
> 因為他的確會傳送一個訊號給電腦，karabiner 就可以攔截到這個訊號、對其鍵位做修改

#### 常見的修改

把左邊的 `alt` 改成 `command`  
左邊的 `windows` 改成 `option`

#### 小鍵盤配置如 keychron k7 的修改

##### 基本調整 Simple Modifications

調整最右手邊的各式功能鍵變成 `right-option` 、 `right-control`

> 左右開弓
> 由於 keychron 鍵盤本身便支援 Mac ，所以不用修改左手邊如 `alt` 或 `windows` 的鍵位

##### 複雜調整 Comple Modifications

> 複雜調整的詳細文件看[這裡](https://karabiner-elements.pqrs.org/docs/manual/configuration/configure-complex-modifications/)  
> 簡言之就是基本上把產好的 `.json` 放到 `~/.config/karabiner/assets/complex_modifications` 就可以在列表看到了

調整 `command + esc` -> `` command + ` ``

> 用來讓在同樣程式不同視窗間的切換更順利

調整 `shift + esc` -> `` shift + ` `` = `~`

> 用來輸入 ~ 的時候更順利

調整 `option + 2` -> `option + f2`

> 用來在使用 sublime text 的時候可以更順利地叫出右鍵選單
