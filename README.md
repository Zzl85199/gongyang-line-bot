# 共養日誌 LINE Bot v2

幫一家人在 LINE 群裡一起照顧毛孩。這版相對舊版的改動：

- 🐞 **修掉時間錯亂 / 第一次就說餵過**：打卡去重改用資料庫唯一鍵做原子處理；時間一律「存 UTC、顯示轉台北」，不再用字串硬切。
- ☁️ **搬到 Vercel + Supabase**：資料、照片、排程都在雲端，不再依賴本機 `db.json` 與記憶體狀態。
- 🐾 **一個群可養多隻寵物**（新增寵物 / 切換 / 各自的提醒與生命之書）。
- 💊🍚🦮 **提醒一般化**：餵藥、餵食、散步、任意自訂提醒，全部同一套機制。
- 🤖 **AI 助手**：群裡用喚醒詞或 @ 機器人，直接用講的新增提醒、查狀態、取消打卡。
- 📋 **今日狀態一覽**、🗑️ **一鍵取消誤觸打卡**、📖 **生命之書回顧（看得到照片）**。

---

## 一、架構為什麼這樣設計

| 需求 | 解法 |
|---|---|
| 時間錯亂、第一次就說餵過 | `lib/time.js` 統一台北時區；`task_logs` 的 `UNIQUE(task_id, log_date, scheduled_time)` 讓打卡在 DB 層原子去重，先到先贏；顯示時用 `done_at`(UTC) 轉台北。 |
| 搬 Supabase + Vercel | Next.js App Router route handlers 跑在 Vercel；資料在 Supabase Postgres；照片在 Supabase Storage。 |
| 多隻寵物 | `pets` 表，一個群多筆；`groups.active_pet_id` 當預設對象。 |
| 餵食 / 散步 / 自訂 | `tasks.kind = med/feed/walk/custom`，同一套提醒與打卡流程。 |
| AI 觸發更彈性 | `lib/ai.js` 用 Claude tool calling；群裡用喚醒詞或 @ 觸發。 |
| 生命之書看不到照片 | 照片存 Supabase Storage，回顧時用簽章 URL 做成 Flex 輪播。 |
| 今日狀態 | 「今天」指令查 `task_logs` 當日紀錄做成清單。 |
| 刪除誤觸打卡 | 打卡確認卡附「取消這筆」按鈕；也可「取消 早餐 07:00」。 |

> **排程的關鍵限制**：Vercel Hobby 的 Cron 每天只能跑一次、且只支援 UTC。餵藥要「每分鐘」檢查，所以**排程放在 Supabase 的 `pg_cron`**，每分鐘打一次 Vercel 的 `/api/cron`。這是免費且可靠的做法（見步驟 4）。

---

## 二、設定步驟

### 1. LINE
1. [LINE Developers Console](https://developers.line.biz/console/) 建一個 Provider → Messaging API channel。
2. 取得 **Channel secret** 與 **Channel access token**。
3. [LINE Official Account Manager](https://manager.line.biz/) → 回應設定：關閉「自動回應」、開啟「Webhook」、允許加入群組。
4. （AI 用 @ 觸發才需要）把這個官方帳號在群裡設成可被 @。

### 2. Supabase
1. 建一個 Supabase 專案。
2. SQL Editor 貼上並執行 `supabase/schema.sql`（會建好所有資料表與照片 bucket）。
3. Project Settings → API 取得 `SUPABASE_URL` 與 **service_role** key。

### 3. 部署到 Vercel
1. 把這個專案推到 GitHub，在 Vercel 匯入。
2. 在 Vercel → Settings → Environment Variables 填入 `.env.example` 裡那幾個值。
3. 部署，拿到網址（例如 `https://gongyang.vercel.app`）。
4. 回 LINE Console 設 Webhook URL：`https://你的網址/api/webhook`，按 Verify、開啟 Use webhook。

### 4. 排程（每分鐘的餵藥提醒）
在 Supabase → Database → Extensions 開啟 **pg_cron** 與 **pg_net**，再到 SQL Editor 執行（把網址與密鑰換成你的）：

```sql
select cron.schedule(
  'gongyang-reminders',
  '* * * * *',
  $$ select net.http_post(
       url     := 'https://你的網址/api/cron',
       headers := jsonb_build_object('Authorization','Bearer 你的CRON_SECRET')
     ); $$
);
```

> 不想用 pg_cron 也可以：到 [cron-job.org](https://cron-job.org) 設每分鐘 GET
> `https://你的網址/api/cron?key=你的CRON_SECRET`。

---

## 三、群裡怎麼用

```
新增寵物 哈吉
新增用藥 腎臟藥 08:00,20:00
新增餵食 早餐 07:00
新增散步 19:00
提醒清單 / 今天 / 回顧
取消 早餐 07:00        ← 刪掉誤觸的打卡

小幫手 幫哈吉設定每天中午12點吃心絲蟲藥   ← AI 自然語言
@共養日誌 今天還有什麼沒做？              ← @ 觸發 AI
```

到時間機器人推提醒 → 按「我做好了 ✅」。第二個人再按會看到「已由 OO 在 HH:MM 做過」（時間正確），按確認卡上的「取消這筆」即可還原誤觸。

---

## 四、檔案結構
```
gongyang-line-bot/
├── app/
│   ├── page.js / layout.js        健康頁
│   └── api/
│       ├── webhook/route.js       LINE webhook（簽章驗證 + 事件路由）
│       └── cron/route.js          每分鐘檢查、推播提醒（DB 去重）
├── lib/
│   ├── time.js                    台北時區工具（修時間 bug 的核心）
│   ├── line.js                    LINE API（fetch）+ 簽章驗證
│   ├── supabase.js                Supabase client
│   ├── db.js                      資料存取 + 原子去重
│   ├── messages.js                LINE 訊息組裝（Flex / 按鈕）
│   ├── ai.js                      Claude tool calling 路由
│   └── handlers.js                文字 / postback / 圖片 事件處理
├── supabase/schema.sql            資料表、唯一鍵、Storage、pg_cron
├── .env.example
└── vercel.json
```

## 五、之後可以再做
- 依寵物年齡 / 病況自動調整任務難度；離世後切換「紀念模式」（`pets.archived` 已預留）。
- 生命之書自動編成月度回顧短片 / 可保存紀念冊。
- 提醒未打卡的「過時補提醒」與家人輪值分工。
