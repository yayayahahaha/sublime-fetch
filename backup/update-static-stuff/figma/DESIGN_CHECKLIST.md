# Figma 圖層命名清單（給設計）

我們現在用工具直接從 Figma 抓圖，不再手動拖選 layer → export → 傳檔案。
工具是**靠圖層名字**找圖的，所以名字必須完全一致，這份清單就是那份名單。

好消息是：**你不需要再設定 export settings**（那些 1x / 2x / 512w 的設定）。
格式和尺寸都由工具決定，Figma 上現有的 export 設定工具完全不看，設錯或漏設都沒關係。

---

## 放在哪裡

```
Page 名字要含 "assets"        ← 目前是「🧩 icon & assets」/「🧩 Logos & Assets ✅」, 都可以
  └── export-area            ← 一個 Frame，名字就叫 export-area
        ├── PWA_icon         ← 要抓的圖都放這一層
        ├── favicon
        └── ...
```

- Page 名字只要**含有 `assets`** 就好，前後的 emoji、✅、大小寫都沒差。
- `export-area` 這個 Frame 的名字要完全一樣（小寫、中間是連字號）。
- 要抓的圖放在 `export-area` **的第一層**。放在裡面的子群組裡會抓不到。
- `export-area` **外面**的東西工具完全不會看（例如 `chatbot_icon`、`metadata`、`Image Icon`、
  `Position Sharing IMG/*` 這些），維持現狀就好。

---

## 需要的 7 個圖層

| 圖層名字 | 尺寸 | 底色 | 用途 |
| --- | --- | --- | --- |
| `pwa-icon` | 64 × 64 | **要有品牌底色** | App icon / PWA / 桌面捷徑圖示（會產出 16～512 共 8 種尺寸） |
| `favicon` | 64 × 64 | **要有品牌底色** | 瀏覽器分頁圖示（`.ico` + `.svg`） |
| `img-social-a` | 400 × 400 | — | 社群分享圖（正方形，OG image） |
| `img-social-b` | 1200 × 675 | — | 社群分享圖（16:9） |
| `qrcode-logo` | 13 × 13 | — | QR code 中間的小 logo |
| `logo-white` | 各品牌自訂 | 透明 | 深色底上用的白色 logo |
| `logo-brand` | 各品牌自訂 | 透明 | 淺色底上用的品牌色 logo |

### 名字的規則

1. **大小寫、連字號、底線、空白都不計較。** 工具比對前會統一處理掉，所以
   `pwa-icon`、`PWA_icon`、`pwa_icon`、`PWA Icon` 都算同一個，用你習慣的寫法就好。
2. **字要對。** 只有分隔符號和大小寫可以自由，字本身要一樣 ——
   `pwa-icon` 可以，`pwaicon2`、`pwa-icons`、`icon-pwa` 都不行。
3. **不能有同名的圖層。** `export-area` 第一層如果有兩個一樣的名字，工具無法判斷要用哪一個，會直接報錯。
4. **同一個項目不要出現兩種寫法。** 例如同時有 `PWA_icon` 和 `pwa-icon` —— 因為兩個都算命中，
   工具一樣無法判斷，會報錯。
5. 名字後面**不要加**尺寸、版本、日期之類的東西（`logo-light_0420`、`favicon 64` 都不行）。
6. 圖層可以是 Frame、Component 或 Instance，這三種都可以。

### `logo-white` / `logo-brand` 的額外要求

- **各只能有一個。**
- **兩個的尺寸必須完全一樣**（寬和高都要一樣）。工具會擋，我們後續的程式也會擋。
- 這兩個會同時產出 SVG 和 PNG，所以請確認是純向量（不要有嵌入的點陣圖／照片）。

### `pwa-icon` 和 `favicon` 要注意底色

Figma 上有兩套長得很像的 icon：

- `pwa-icon` / `favicon` → **有品牌底色的實心圖**，這兩個是這份清單要的
- `support-logo-a` / `support-logo-b` → **透明背景**，那是給客服系統（Freshdesk）用的

尺寸幾乎一樣所以很容易混。工具是靠名字抓的，只要名字對就不會拿錯。

---

## 現在要請你改的

只有 logo 這兩個：

| 目前的名字 | 要改成 | 問題 |
| --- | --- | --- |
| `logo-BTSE-id_2`（BTSE Indonesia，**3 個同名**） | `logo-white` 和 `logo-brand` 各一個 | 名字不在清單裡，而且同名重複 |
| `_wl-logo`（ZMO，**2 個同名**） | `logo-white` 和 `logo-brand` 各一個 | 同上 |

其他 5 個（`pwa-icon`、`favicon`、`img-social-a`、`img-social-b`、`qrcode-logo`）
在兩個檔案裡都已經可以正確命中，不用動。

（`pwa-icon` 目前在 Figma 上叫 `PWA_icon`，因為大小寫和底線不計較，所以照樣抓得到。
想改成 `pwa-icon` 可以改，不改也沒關係 —— 但**不要兩個都放**。）

> 如果那些同名的圖層其實是不同用途（例如不同尺寸的展示版本），
> 請只留一組 `logo-white` / `logo-brand` 在 `export-area` 第一層，
> 其他的搬到 `export-area` 外面就好 —— 外面的工具不會看。

> 這兩支 logo 在我們程式裡會存成 `logo-light` / `logo-dark` 這兩個檔名（FE 那邊沿用已久的命名）。
> 這個轉換是工具自動做的，**Figma 上請就用 `logo-white` / `logo-brand`**，不用配合我們的檔名。
> 舊的 `logo-light` / `logo-dark` 也還是收，所以要分批改也沒問題。

---

## 不在清單裡的圖層會怎樣

不會被匯出，工具只會列出來提醒一下，**不算錯誤**。
所以 `support-logo-a`、`support-logo-b` 這些維持現在的人工流程就好，不用改名也不用搬。

## 名字不對會怎樣

工具會停下來並明確講是哪個圖層、什麼問題，例如：

```
❌ [DUP] _wl-logo: export-area 第一層有 2 個同名節點 (74x24, 74x24)
❌ [MISSING] logo-white: mapping 表裡有, 但 Figma 的 export-area 裡找不到 (可接受的名字: logo-white / logo-light)
❌ [MULTI-MATCH] pwa-icon: 同時命中 2 個圖層 (PWA_icon, pwa-icon), 無法決定要用哪個, 請只留一個
❌ [SIZE] favicon: 節點尺寸應為 64x64, 實際是 32x32
❌ [LOGO-PAIR] logo-white / logo-brand: 兩支 logo 尺寸必須一致, 但是 74x24 和 80x24
```

其他沒問題的圖還是會照樣匯出，不會因為一個錯就全部停擺。

---

> 這份清單的內容來自 `figma/mapping.js`，改動 mapping 表時要同步更新這裡。
