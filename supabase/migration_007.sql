-- ============================================================
--  共養日誌 v2 — migration 007
--  #1 角色權限（owner/caregiver/viewer，預設「不啟用」=大家都能操作）
--  #3 健康紀錄時間軸（體重/食慾/症狀/備註）—— 累積病史的護城河
--  在 Supabase SQL Editor 貼上執行一次即可（可安全重複執行）。
-- ============================================================

-- 角色是「選用」的：roles_enabled 預設 false → 行為跟現在一樣，誰都能操作。
-- 有人「我是主飼主」啟用後才開始按角色把關。
alter table groups add column if not exists roles_enabled boolean default false;

-- 成員：以 LINE userId 為主鍵的一部分，記住這個照護圈裡誰是誰、角色為何。
create table if not exists members (
  group_id     text not null references groups(id) on delete cascade,
  user_id      text not null,
  display_name text,
  role         text not null default 'caregiver',  -- owner | caregiver | viewer
  updated_at   timestamptz default now(),
  primary key (group_id, user_id)
);

-- 健康紀錄（縱向時間軸）。一筆一個事件。
--   kind = weight   → value_num 存公斤
--   kind = appetite → value_text 存「正常/不佳/沒吃」等
--   kind = symptom  → value_text 存症狀描述
--   kind = note     → value_text 存自由備註
create table if not exists health_logs (
  id          bigserial primary key,
  pet_id      bigint not null references pets(id) on delete cascade,
  group_id    text not null,
  kind        text not null,
  value_num   numeric,
  value_text  text,
  by_name     text,
  created_at  timestamptz default now()
);
create index if not exists idx_health_pet on health_logs(pet_id, created_at desc);
create index if not exists idx_health_pet_kind on health_logs(pet_id, kind, created_at desc);
