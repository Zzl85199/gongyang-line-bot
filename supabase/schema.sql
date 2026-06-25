-- ============================================================
--  共養日誌 v2 — Supabase schema
--  在 Supabase Dashboard → SQL Editor 全部貼上執行一次即可。
-- ============================================================

-- ---------- 1. 照護圈（一個 LINE 群 / 房 / 一對一 = 一筆） ----------
create table if not exists groups (
  id              text primary key,         -- LINE 的 groupId / roomId / userId
  active_pet_id   bigint,                    -- 指令沒指定寵物時的預設對象
  wake_word       text default '小幫手',     -- 觸發 AI 的喚醒詞（可改）
  created_at      timestamptz default now()
);

-- ---------- 2. 寵物（一個群可以有「多隻」，解掉舊版只能綁一隻的限制） ----------
create table if not exists pets (
  id          bigserial primary key,
  group_id    text not null references groups(id) on delete cascade,
  name        text not null,
  species     text,                          -- 狗 / 貓 / ...（之後做年齡自動調檔用）
  archived    boolean default false,         -- 之後「紀念模式」用
  created_at  timestamptz default now()
);
create index if not exists idx_pets_group on pets(group_id);

-- ---------- 3. 任務 / 提醒（把「用藥」一般化成任意提醒：餵藥·餵食·散步·自訂） ----------
create table if not exists tasks (
  id          bigserial primary key,
  pet_id      bigint not null references pets(id) on delete cascade,
  group_id    text not null references groups(id) on delete cascade,
  kind        text not null default 'custom', -- med | feed | walk | custom
  name        text not null,                  -- 「腎臟藥」「早餐」「晚間散步」
  emoji       text,                           -- 顯示用，例如 💊🍚🦮
  times       text[] not null default '{}',   -- ["08:00","20:00"]
  active      boolean default true,
  created_at  timestamptz default now()
);
create index if not exists idx_tasks_group on tasks(group_id);
create index if not exists idx_tasks_pet on tasks(pet_id);

-- ---------- 4. 打卡紀錄（防重複給藥的核心） ----------
-- 關鍵：UNIQUE(task_id, log_date, scheduled_time)
-- 由「資料庫層級的唯一鍵」保證原子性 → 不管 LINE 重送幾次、serverless 併發幾個，
-- 同一隻寵物、同一個任務、同一天、同一個時段，只會成功寫入一筆。先到先贏。
create table if not exists task_logs (
  id              bigserial primary key,
  task_id         bigint not null references tasks(id) on delete cascade,
  pet_id          bigint not null,
  group_id        text not null,
  log_date        date not null,             -- 台北日期
  scheduled_time  text not null,             -- 該次提醒的時段 "18:00"
  done_by_user_id text,
  done_by_name    text,
  done_at         timestamptz default now(), -- 一律存 UTC；顯示時程式端轉台北
  unique (task_id, log_date, scheduled_time)
);
create index if not exists idx_logs_group_date on task_logs(group_id, log_date);

-- ---------- 5. 提醒已發送紀錄（取代舊版記憶體裡的 Set，serverless 上才不會漏 / 重發） ----------
create table if not exists reminder_sent (
  id              bigserial primary key,
  task_id         bigint not null references tasks(id) on delete cascade,
  log_date        date not null,
  scheduled_time  text not null,
  sent_at         timestamptz default now(),
  unique (task_id, log_date, scheduled_time)
);

-- ---------- 6. 生命之書（照片真的存得到、看得到） ----------
create table if not exists lifebook (
  id          bigserial primary key,
  pet_id      bigint not null references pets(id) on delete cascade,
  group_id    text not null,
  kind        text default 'memory',         -- memory | task
  caption     text,
  task_title  text,
  photo_path  text,                           -- Supabase Storage 內的路徑
  by_name     text,
  created_at  timestamptz default now()
);
create index if not exists idx_lifebook_pet on lifebook(pet_id, created_at desc);

-- ---------- 7. Storage：建立放照片的 bucket（私有，靠簽章 URL 給 LINE 顯示） ----------
insert into storage.buckets (id, name, public)
values ('lifebook', 'lifebook', false)
on conflict (id) do nothing;

-- ---------- 7b. AI 路徑強化（過時補提醒 / 輪值 / 一次性提醒） ----------
alter table groups add column if not exists overdue_minutes int default 0;
alter table groups add column if not exists duty_rotation text[] default '{}';
alter table groups add column if not exists duty_anchor date;

create table if not exists oneoff_reminders (
  id              bigserial primary key,
  pet_id          bigint not null references pets(id) on delete cascade,
  group_id        text not null,
  task_id         bigint references tasks(id) on delete set null,
  scheduled_time  text,
  label           text not null,
  emoji           text,
  remind_at       timestamptz not null,
  sent            boolean default false,
  created_at      timestamptz default now()
);
create index if not exists idx_oneoff_due on oneoff_reminders(sent, remind_at);

create table if not exists overdue_sent (
  id              bigserial primary key,
  task_id         bigint not null references tasks(id) on delete cascade,
  log_date        date not null,
  scheduled_time  text not null,
  sent_at         timestamptz default now(),
  unique (task_id, log_date, scheduled_time)
);

-- ============================================================
--  8. pg_cron：每分鐘打一次你部署在 Vercel 的 /api/cron
--     （Vercel Hobby 的 cron 每天只能跑一次，所以排程放在 Supabase 這邊）
--     先到 Dashboard → Database → Extensions 開啟 pg_cron 與 pg_net，再執行下面。
--     把 <YOUR_VERCEL_URL> 換成你的網址，<CRON_SECRET> 換成你設在 Vercel 的同一組密鑰。
-- ============================================================
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- select cron.schedule(
--   'gongyang-reminders',
--   '* * * * *',  -- 每分鐘
--   $$
--     select net.http_post(
--       url     := 'https://<YOUR_VERCEL_URL>/api/cron',
--       headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
--     );
--   $$
-- );
--
-- 要停掉：select cron.unschedule('gongyang-reminders');
