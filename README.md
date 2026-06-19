# 共養日誌 LINE Bot

一個 LINE 聊天機器人:幫一家人共同照顧毛孩。
- 餵藥提醒 + 一鍵打卡,自動防止重複給藥
- 生命之書任務系統:定時自動出任務,或隨時跟它要;難度可調(簡單「摸屁屁」↔ 困難「爬山」)
- 完成任務拍照傳進群,自動收進生命之書

---

## 一、它會做什麼(指令一覽)

把 bot 加進你家的照護 LINE 群後:

基本設定
- `綁定 咪咪` — 設定毛孩名字
- `新增用藥 腎臟藥 08:00,20:00` — 設定餵藥時間
- `用藥清單` / `設定` — 查看

餵藥(自動)
- 到時間,bot 會在群裡推提醒,餵好按「我餵了 ✅」
- 第二個人再按,會看到「已由 OO 在 HH:MM 餵過」——這就是防重複給藥

生命之書任務
- `任務` — 立刻來一個任務
- `任務 簡單` / `任務 困難` — 指定難度
- `難度 簡單` — 設定自動任務的預設難度
- `頻率 3` — 每幾天自動出一個任務
- `生命之書` — 看收藏的時光
- 任務完成後,把照片傳進群組 → 自動收進生命之書

---

## 二、你需要先做的事(只有你能做)

我寫好了程式,但 LINE bot 需要「你自己的官方帳號憑證」和「一個對外網址」。以下這幾步請你完成:

### 1. 申請 LINE 官方帳號 + Messaging API
（注意:舊的 LINE Notify 已於 2025/3/31 停止,推播一律走 Messaging API)
1. 到 LINE Developers Console:https://developers.line.biz/console/
2. 建立一個 Provider
3. 建立一個 Messaging API channel(會同時產生一個 LINE 官方帳號)

### 2. 取得兩把鑰匙
在該 channel 的設定頁面取得:
- Channel secret(在 Basic settings)
- Channel access token(在 Messaging API,點「Issue」發一個 long-lived token)

### 3. 關閉自動回應、允許加入群組
到 LINE Official Account Manager(https://manager.line.biz/)→ 設定 → 回應設定:
- 「自動回應訊息」關閉
- 「Webhook」開啟
- 允許加入群組(聊天設定裡)

---

## 三、把程式跑起來

### 安裝
```bash
npm install
cp .env.example .env
```
編輯 `.env`,填入你的兩把鑰匙:
```
LINE_CHANNEL_ACCESS_TOKEN=填入你的_token
LINE_CHANNEL_SECRET=填入你的_secret
PORT=3000
TZ=Asia/Taipei
```

### 啟動
```bash
npm start
```
看到 `listening on :3000` 就成功了。

### 讓 LINE 連得到你(取得對外網址)
LINE 的伺服器要能呼叫到你的 webhook,所以需要一個 https 公開網址。

最快的方式 —— 用 ngrok(本機測試):
```bash
# 另開一個終端機
npx ngrok http 3000
```
它會給你一個像 `https://xxxx.ngrok-free.app` 的網址。

要長期穩定 —— 部署到雲端(擇一):
- Render(https://render.com)、Railway、Fly.io 都可以免費起步
- 把這個專案推上 GitHub,連到平台,設定環境變數(那兩把鑰匙),部署後會拿到一個固定網址

### 設定 Webhook URL
回到 LINE Developers Console → 你的 channel → Messaging API → Webhook URL,填:
```
https://你的網址/webhook
```
按「Verify」,顯示成功即可。記得把「Use webhook」打開。

### 開始用
1. 把這個官方帳號加為好友(掃 QR code)
2. 把它邀請進你家的照護 LINE 群
3. 在群裡輸入 `綁定 咪咪` 開始

---

## 四、目前的限制與下一步

- 資料存在本機的 `data/db.json`(照護圈設定、用藥、生命之書)和 `data/photos/`(任務照片)。MVP 夠用;若要多台部署,需換成資料庫(PostgreSQL),並把照片改存雲端(S3 等)。
- 防重複給藥目前靠「單一程序內的同步處理」,單機正確。若未來跑多個執行個體,需改用資料庫層級的鎖。
- 任務難度目前由使用者調整(符合你的需求)。之後可以再加「依寵物年齡/病況自動調檔」與「離世後切換為紀念模式」(見產品設計文件)。
- 生命之書目前是「收藏 + 列表」。把照片自動編成回顧短片/可保存的紀念冊,是下一階段。

---

## 五、檔案結構
```
gongyang-line-bot/
├── package.json
├── .env.example
├── README.md
└── src/
    ├── index.js      主程式:webhook、事件路由、防重複打卡、兩個排程
    ├── store.js      JSON 檔案儲存
    ├── tasks.js      任務庫(分難度)與選任務邏輯
    └── messages.js   LINE 訊息組裝
```
