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

---

## 修補紀錄（2026-06 patch）

這次修掉了「提醒不會發、AI 沒記憶、提醒可能沒設成功」三件事：

1. **`/api/cron` 直接 500、提醒一封都發不出去（最關鍵）**
   `app/api/cron/route.js` 裡 `run()` 在 `return pushed;` 後面黏了一段死碼，而 `authorized()` 這個函式根本沒被定義，`GET` 一呼叫就 `ReferenceError`。已把 `authorized()` 補成正式函式、刪掉死碼。

2. **沒有任何排程器每分鐘打 `/api/cron`**
   `vercel.json` 的 `crons` 是空的、`schema.sql` 的 pg_cron 區塊是註解掉的，所以就算 (1) 修好也沒人觸發。請執行新檔 **`supabase/migration_005_cron.sql`**（把 `<YOUR_VERCEL_URL>`、`<CRON_SECRET>` 換成你的值後，在 Supabase SQL Editor 跑一次）。跑完用 `select * from cron.job_run_details order by start_time desc limit 20;` 確認每分鐘有 200。

3. **AI 沒有對話記憶**
   舊版每次都只把「當前這句」丟給模型，所以你說「這樣沒問題」時它不知道指的是什麼（跟用 Gemini 或 Claude 無關）。新增 `chat_messages` 表（**`supabase/migration_004.sql`**），`lib/db.js` 加了 `saveChatMessage` / `recentChatMessages`，`lib/ai.js` 會載入該照護圈最近 10 句一起送進模型，並把每輪存回去。

4. **提醒可能「沒設成功」/ 重複設定**
   - 強化 system prompt：使用者回「好／可以／沒問題」時，模型要「立刻呼叫工具」把設定寫進去，而不是只回「我會幫你設定」。
   - `add_reminder` 改為去重：同一隻寵物若已有同名提醒，會「更新時間」而非再插一筆，避免重複任務造成重複推播。
   - 想確認到底設好沒，最可靠是打確定性指令 **「提醒清單」**。

### 升級前必跑（Supabase SQL Editor，各跑一次）
- `supabase/migration_004.sql` — 對話記憶表
- `supabase/migration_005_cron.sql` — 每分鐘排程（記得先填 URL 與 CRON_SECRET、並開啟 pg_cron / pg_net 擴充）

> 另外：截圖最上面那張 18:00 餵藥卡，文案與按鈕（「我餵了 ✅」「避免重複給藥」）跟現行 `lib/messages.js` 不一致，是**舊版送出的歷史訊息**，不是現在的設定。若 `tasks` 表還留著那筆舊餵藥任務，請用「刪除提醒」或在 DB 清掉。

---

## Phase 1 + Phase 2（2026-06）

繼續壓在 LINE bot 上，把平台能力長到 bot 旁邊。**升級前請先在 Supabase SQL Editor 跑一次 `supabase/migration_006.sql`。**

### Phase 1 — 補滿核心止痛藥
1. **用藥劑量結構化**：`tasks.dosage` 獨立欄位（不再塞在名稱字串）。提醒卡、過時補提醒、提醒清單都會顯示「劑量：…」。AI 設定時直接講即可，例如「小幫手 幫哈吉設定腎臟藥 每次半顆 08:00,20:00」；`add_reminder` / `edit_reminder` 都支援 dosage。這筆資料之後會長成病史。
2. **過時補提醒指名輪值者**：原本只在結尾附「今天輪到 X」，現在直接以對方開頭點名（「⚠️ 媽，哈吉的腎臟藥（20:00）還沒人完成，今天輪到你囉 🙋」），語氣更明確。沿用既有的 `duty_rotation`。
3. **破壞性操作的最低防護**：刪除提醒、取消打卡、進入安寧/紀念一律走「確認卡」二次確認（既有機制）。在 LINE 群（家人皆可信任）情境下，暫不另建 owner/caregiver/viewer 角色系統。

### Phase 2 — 情感黏著（Doc 4 基本迴圈）
4. **每週自動丟任務**：靠修好的 cron，每週六 10:00 起，對每隻在養寵物各推一個互動小任務（每隻每週一次，`pets.last_task_week` 去重）。任務內容與語氣由狀態引擎決定。
5. **照片圖鑑收集**：傳照片進群後，除了收進生命之書，還會用「快速回覆」問要不要收進某本圖鑑（睡姿/表情包/散步/合照…）。圖鑑目錄在 `lib/collections.js`，進度由 `lifebook.collection_key` 即時統計；指令「圖鑑」可看收集進度，集滿會慶祝（受狀態守門）。
6. **顯式的寵物狀態 + 語氣/降檔系統**（`lib/petstate.js`，全專案最該謹慎的一塊）：
   - 狀態：活力/陪伴/熟齡/療程/安寧/紀念，由 年齡＋病況＋`care_state`＋`archived` 推導。
   - **硬規則（已用程式落實）**：紀念期停所有提醒與任務、絕不慶祝；安寧期仍發藥物提醒，但不自動丟任務、不慶祝、語氣最輕柔。
   - 進入安寧是敏感轉換 → 一律確認卡 + 溫柔文案，不冷冰冰宣告。指令「安寧 哈吉」進入、「恢復照護 哈吉」結束；AI 也有 `enter_hospice` / `restore_care` / `show_collections`。
   - 提醒：活動建議、每週任務、圖鑑集滿慶祝，全部統一走 `careTone()` 這個單一事實來源，未來要加任何慶祝動畫時天生就被守門。

### 需要跑的 migration（Supabase SQL Editor）
- `migration_004.sql`（對話記憶，前一批）
- `migration_005_cron.sql`（每分鐘排程，前一批）
- `migration_006.sql`（本批：dosage / care_state / last_task_week / collection_key）

---

## Phase 3 + 角色權限（2026-06）

**升級前先在 Supabase SQL Editor 跑 `supabase/migration_007.sql`。**

### 角色權限（owner / caregiver / viewer）— 刻意做成「選用」
- 預設 `roles_enabled = false` → **開放模式，誰都能操作**（跟原本一樣，不強制設定）。
- 有人打「我是主飼主」才啟用把關。啟用後三層：主飼主（改排程/刪除/設角色）＞照顧者（打卡/傳照片/記健康）＞唯讀（只能看）。
- **不會鎖死家人**：啟用後沒被指派到的人，預設當「照顧者」（能幫忙打卡，只是不能改排程）。隨時「停用權限」回到開放模式。
- 邏輯集中在 `lib/perms.js`，文字指令與 AI 工具兩條路都會把關（AI 路徑由 `handleAI` 把 `canManage/canCheckin` 帶進工具執行）。

### Phase 3 — 健康紀錄時間軸（累積病史的護城河）
- 新表 `health_logs`（體重/食慾/症狀/備註，事件式時間軸）。
- 文字：「體重 哈吉 5.2」「食慾 哈吉 不佳」「症狀 哈吉 嘔吐兩次」「健康紀錄 哈吉」。
- AI：「小幫手 哈吉今天 5.2 公斤，食慾不太好」→ `log_health`；「哈吉的病歷」→ `show_health`。
- 體重會自動算與上次的增減；「健康紀錄」會顯示體重趨勢 + 最近事件。
- 加碼：**一鍵交接卡**「交接卡 哈吉」——把基本資料＋每日提醒＋今天進度＋最近體重/狀況整理成一張，給保母/獸醫。

---

## 完整指令手冊（操作手冊）

> 在群組或一對一都可用。AI 需以喚醒詞（預設「小幫手」）開頭或 @機器人。打「幫助」看精簡版、「教學」看三步驟上手。

### 寵物
| 指令 | 說明 |
|---|---|
| `新增寵物 哈吉` | 加一隻毛孩 |
| `寵物清單` | 看有哪些、誰是預設 |
| `切換 哈吉` | 之後指令沒指定就用這隻 |

### 提醒（餵藥/餵食/散步/自訂）
| 指令 | 說明 |
|---|---|
| `新增用藥 腎臟藥 08:00,20:00` | 多時段用逗號分隔 |
| `新增餵食 早餐 07:00` / `新增散步 19:00` | |
| `新增提醒 點眼藥 09:00,21:00` | 自訂提醒 |
| `新增餵食 哈吉 早餐 07:00` | 多隻時可加寵物名 |
| `提醒清單` | 列出全部（含劑量） |
| `刪除提醒 早餐` | |
| 劑量請用 AI：`小幫手 設定腎臟藥 每次半顆 08:00,20:00` | 會顯示在提醒卡上 |

### 每天
| 指令 | 說明 |
|---|---|
| 到點推提醒 → 按 `我做好了 ✅` | 系統擋重複給藥 |
| `今天` | 看每件事做了沒 |
| `取消 早餐 07:00` | 刪掉誤觸的打卡 |
| `輪值 爸 媽 我` | 每天輪一位；過時補提醒會點名當天的人 |
| `過時提醒 30` / `關閉過時提醒` | 超過 N 分沒打卡補提醒一次 |

### 健康（Phase 3）
| 指令 | 說明 |
|---|---|
| `體重 哈吉 5.2` | 記體重，會算與上次增減 |
| `食慾 哈吉 不佳` / `症狀 哈吉 嘔吐兩次` | |
| `健康紀錄 哈吉` | 病歷時間軸 + 體重趨勢 |
| `交接卡 哈吉` | 給保母/獸醫的一頁摘要 |

### 生命之書 / 回憶
| 指令 | 說明 |
|---|---|
| 傳照片進群 | 自動收藏，並可選收進某本圖鑑 |
| `回顧` | 最近的照片時光 |
| `圖鑑` | 各系列收集進度 |
| `紀念冊` | 可保存、自動播放的網頁 |
| `任務` | 依狀態給個互動小任務（每週六也會自動丟一個） |

### 狀態（重大轉換，會先確認）
| 指令 | 說明 |
|---|---|
| `安寧 哈吉` / `恢復照護 哈吉` | 安寧期：藥提醒照常、停任務與慶祝 |
| `紀念 旺旺` | 離世後開啟紀念模式，停所有提醒 |

### 角色權限（選用）
| 指令 | 說明 |
|---|---|
| `我是主飼主` | 啟用權限，自己成為主飼主 |
| `成員` | 看誰是什麼角色 |
| `設定 媽媽 為 照顧者` | 主飼主指派（對方需先互動過） |
| `停用權限` | 回到大家都能操作 |

### AI 自然語言（喚醒詞開頭或 @機器人）
```
小幫手 幫哈吉早晚各一次餵腎臟藥，每次半顆
小幫手 把早餐改成 8 點 / 晚點 30 分鐘再提醒我散步
小幫手 哈吉今天 5.2 公斤，食慾不太好
小幫手 哈吉的病歷 / 哈吉的圖鑑收集到哪了
@共養日誌 今天還有什麼沒做？
```

---

## 圖鑑改版 + 庫存提醒（2026-06）

**升級前先在 Supabase SQL Editor 跑 `supabase/migration_008.sql`。**

### 圖鑑改版（無分母系列 + 重要時刻 + 自訂 + 集滿自動拼回顧卡）
- **不再有 `n/target` 進度條與「集滿」壓力**。系列（睡姿、表情包…）只報張數；到 5/10/20… 的柔性里程碑會給一句溫暖回饋，並**自動把該系列拼成一張回顧卡**（照片輪播，天生可分享）。
- 新增 **重要時刻 🏅**（事件型，報「第 N 個瞬間」，不算進度）。
- **自訂圖鑑**：「新增圖鑑 復健紀錄」或對小幫手說，`new_collection`；存在 `custom_collections`，key = `c`+id。
- **加錯可改**：傳照片後的確認訊息附「改放別本 / 移出圖鑑」；或「改圖鑑」重分類最近一張；或「更多分類」看全部圖鑑。對應 postback：`file` / `morefile` / `unfile`。
- 安寧/紀念狀態：里程碑回顧與慶祝語氣自動收斂（沿用 `careTone` 守門）。

### 庫存提醒（可設定，但預設不啟用、不強制）
- 用藥 `tasks.stock_count` 預設 null = **完全不追蹤、行為跟現在一樣**。
- 設了才有行為：「庫存 腎臟藥 30」或對小幫手說（`set_stock`）。之後**每次打卡自動扣 1**（`stock_per_dose`，預設 1），低於門檻（`stock_threshold`，預設 5）或用完時，打卡回覆會附一則補貨提醒；取消打卡會補回庫存。
- 剩餘量會顯示在「提醒清單」。

### 需要跑的 migration
- `migration_008.sql`（custom_collections + tasks 庫存欄位）

---

## Phase 4 + 三個修補（2026-06）

**升級前先在 Supabase SQL Editor 跑一次 `supabase/migration_009_webapp.sql`。**

### 這次修掉的三件事
1. **無分母系列不再報「第 N 張」**：平常收照片只回「已收進某圖鑑 📚」，到 5/10/20… 的柔性里程碑才慶祝並自動拼回顧卡（`lib/messages.js` 的 `collectionFiled`）。
2. **小任務卡找回「換一個 / 簡單一點 / 想動一動」**：抽到做不到的可直接換掉。`suggestActivity` 支援指定難度（會被寵物狀態夾住，安寧/療程只給溫和的），卡片下方加了快速回覆按鈕，`handlers.js` 新增 `a=task` postback。
3. **提醒到點不發 → 加容錯窗**：`/api/cron` 不再要求「分秒剛好對上」，到點後 `REMINDER_GRACE_MIN`（預設 5）分鐘內都會補發一次；DB 唯一鍵去重保證一槽一天只發一次。
   - ⚠️ 仍要有人「每分鐘」打 `/api/cron`。若提醒整個沒動，先確認 `migration_005_cron.sql` 有跑、URL/`CRON_SECRET` 正確，並用 `select * from cron.job_run_details order by start_time desc limit 20;` 看每分鐘是不是 200。

### Phase 4 — 網頁後台
跑在同一個 Next.js 專案（`/app`）。功能：
- **帳號**：可用 **LINE 登入**或 **Email 註冊**。`migration_009` 會從現有 `members` 回填 `app_users`。
- **存取模型（也是「更好的辦法」）**：把 **LINE Login channel 放在跟 Messaging API 同一個 Provider**，回傳的 `userId` 就會和機器人看到的一致 → 家人一登入自動對上自己照顧的毛孩，**預設都是主飼主（owner）**，不必再邀請。
- **對外授權**：主飼主可產生**邀請連結**開放給群外的人（獸醫／保母），預設唯讀、可隨時撤銷（`access_grants`）。對方點連結 → 登入/註冊 → 啟用。
- **頁面**：`今天`（每個時段一鍵打卡，全家同步）、`排程`（新增/改時間或劑量/刪除提醒的管理表）、`成員 / 授權`（角色把關開關、調整家人角色、產生/撤銷邀請）。

### 需要的環境變數（新增，見 `.env.example`）
- `AUTH_SECRET`（session 簽章；不填退回用 `CRON_SECRET`）
- `LINE_LOGIN_CHANNEL_ID` / `LINE_LOGIN_CHANNEL_SECRET`（LINE 登入；Callback 設 `https://你的網址/api/auth/line/callback`）
- `REMINDER_GRACE_MIN`（選填，預設 5）

### 要跑的 migration
- `migration_009_webapp.sql`（本批：app_users / access_grants / 從 members 回填）

---

## Phase 5（網頁五大功能，2026-06）

**升級前先在 Supabase SQL Editor 跑一次 `supabase/migration_010_web_phase5.sql`。**（新增 `walk_logs` 表與 `pets.handoff_config`）

網頁後台多了五塊，全部依角色把關（唯讀只能看、照顧者可增刪改、主飼主可管檔案與授權）：

1. **健康 `/app/[groupId]/health`**：體重折線圖（內建輕量 SVG，不依賴圖表套件）+ 食慾／症狀／備註時間軸，可新增/編輯/刪除。
2. **交接卡（可列印）`/handoff/[petId]?k=token`**：乾淨、可列印（瀏覽器「列印→存成 PDF」）的一頁摘要，不需登入、用 token 防護，適合丟給保母／獸醫。**要顯示哪些區塊**（基本/提醒/今天/體重/狀況/散步/聯絡）由飼主在「毛孩檔案」勾選；分享連結也在那裡產生。
3. **相簿 / 圖鑑 `/app/[groupId]/album`**：依圖鑑分類瀏覽照片，可改說明、改分類、刪除（刪除限主飼主，會連同 Storage 圖檔一起刪），並可一鍵把某本圖鑑的**回顧**推回 LINE 群。
4. **達成率 `/app/[groupId]/stats` + 散步日誌 `/app/[groupId]/walks`**：本週每個提醒「應完成/實際完成」與達成率長條圖；散步日誌記地點/心情/時間，可在網頁增刪改查，LINE 也能打「遛 哈吉 河堤 開心」記一筆、「散步紀錄 哈吉」查看。
5. **毛孩檔案 `/app/[groupId]/pets`（主飼主）**：新增/編輯毛孩（名字/品種/生日/病況）、狀態切換（一般 / 安寧 / 紀念，敏感操作會二次確認）、交接卡設定，以及照護圈設定（輪值名單、過時補提醒分鐘數）。

### 新增的 LINE 指令
| 指令 | 說明 |
|---|---|
| `遛 哈吉 河堤 開心` / `遛狗 河堤` / `散步打卡 …` | 記一筆散步（地點 心情） |
| `散步紀錄 哈吉` / `散步日誌` | 看最近的散步紀錄 |

### 要跑的 migration
- `migration_010_web_phase5.sql`（本批：walk_logs / pets.handoff_config）
