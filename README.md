# 抽獎系統

Facebook、X、Threads 貼文抽獎工具。抓下貼文的留言、按讚和分享名單，設定參加條件和獎品，公平地隨機抽出得獎者。

**網站：https://xiiao5777.github.io/socialMedia-draw/**

- 免費、不用登入，名單只存在使用者自己的瀏覽器，不會上傳
- 同一個人留言很多次只算一次，抽出的人自動移出抽獎池
- 參加條件：留言、按讚、分享、標記幾位好友、包含關鍵字、排除名單
- 複製得獎公告、下載 CSV 紀錄，抽獎過程全部有紀錄

## 怎麼用

1. 在[首頁](https://xiiao5777.github.io/socialMedia-draw/#install)把「抓取抽獎名單」按鈕拖到瀏覽器的書籤列（每台電腦裝一次）。
2. 打開 Facebook、X 或 Threads 的貼文，按書籤列的「抓取抽獎名單」。工具會對照貼文上的數量，抓完自動停，再按「送到抽獎系統」，名單就會加進[抽獎頁](https://xiiao5777.github.io/socialMedia-draw/draw.html)（也可以按「複製結果」自己貼上）。要抓按讚或分享的人，就在工具上按「按讚」或「分享」，再點開貼文的那份名單，工具會自動開始抓。
3. 在抽獎頁的「準備」頁設定條件和獎品，再到「抽獎」頁按「抽出 1 位」。

各平台的詳細步驟和常見問題都在首頁。遇到問題請到 [Issues](https://github.com/xiiao5777/socialMedia-draw/issues) 回報。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `index.html` | 首頁：安裝說明、使用教學、常見問題。由 `build.js` 產生，請改 `src/index.template.html` |
| `draw.html` | 抽獎頁（「準備」和「抽獎」兩頁，網址的 `#setup` / `#draw` 決定顯示哪一頁） |
| `theme.js` | 黑底／白底切換，兩個頁面共用，選擇存在瀏覽器裡 |
| `src/index.template.html` | 首頁的原始檔 |
| `src/collector.js` | 名單抓取工具（書籤）的原始碼 |
| `build.js` | 把抓取工具壓縮成書籤網址，填進首頁 |
| `tests/` | 自動測試，用模擬的 Facebook、X、Threads 頁面 |

網站是純靜態網頁，由 GitHub Pages 直接發佈 `main` 分支的根目錄。

## 開發

需要 Node.js 18 以上。

```sh
npm install
npx playwright install chromium   # 只有跑測試才需要
npm run build                     # 改了 src/ 之後重新產生 index.html
npm test                          # 檢查 index.html 是最新的，再跑全部測試
```

### 發佈新版抓取工具

1. 把 `src/collector.js` 的 `VERSION` 和 `draw.html` 的 `COLLECTOR_VERSION` 改成同一個新版號，兩個不一樣時 build 會失敗。
2. 改寫 `src/index.template.html` 裡「更新了」那一塊，說明這一版改了什麼。
3. `npm run build`，跑 `npm test`，再 commit `index.html`。

使用者把舊版書籤抓的名單貼到抽獎頁時，抽獎頁會提醒他們重新安裝。

「送到抽獎系統」用 `window.open` 打開 `draw.html#receive`（同一個分頁名稱 `giveaway-draw` 會重複使用），再用 `postMessage` 交名單：工具一直送 `hello`，抽獎頁回 `ready` 後送出 `send`，抽獎頁回 `ack`（`ok` 和一句說明）。抽獎頁只接受 Facebook、X、Threads 網域送來的訊息；新分頁被擋住時工具改成複製。

### 換網址

repo 改名或搬家時，要改 `build.js` 的 `SITE_URL` 和 `REPO_URL` 再 build 一次，因為書籤裡的「送到抽獎系統」和「打開抽獎系統」都會連到這個網址。`draw.html` 頁尾的「回報問題」連結也要一起改。
