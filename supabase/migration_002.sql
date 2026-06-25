-- ============================================================
--  共養日誌 v2 — migration 002（AI 路徑強化）
--  你之前已經跑過 schema.sql，這支只「補上新東西」，可安全重複執行。
--  在 Supabase SQL Editor 貼上執行一次即可。
-- ============================================================

-- 照護圈：過時補提醒分鐘數（0=關閉）＋輪值名單與起算日
alter table groups add column if not exists overdue_minutes int default 0;
alter table groups add column if not exists duty_rotation text[] default '{}';
alter table groups add column if not exists duty_anchor date;

-- 一次性提醒（順延 / 「晚點再提醒我」用）
create table if not exists oneoff_reminders (
  id              bigserial primary key,
  pet_id          bigint not null references pets(id) on delete cascade,
  group_id        text not null,
  task_id         bigint references tasks(id) on delete set null,
  scheduled_time  text,                 -- 顯示與打卡用的時段 "21:00"
  label           text not null,
  emoji           text,
  remind_at       timestamptz not null, -- 到這個時間就推
  sent            boolean default false,
  created_at      timestamptz default now()
);
create index if not exists idx_oneoff_due on oneoff_reminders(sent, remind_at);

-- 過時補提醒「已發送」紀錄（唯一鍵保證一個時段只補一次）
create table if not exists overdue_sent (
  id              bigserial primary key,
  task_id         bigint not null references tasks(id) on delete cascade,
  log_date        date not null,
  scheduled_time  text not null,
  sent_at         timestamptz default now(),
  unique (task_id, log_date, scheduled_time)
);
