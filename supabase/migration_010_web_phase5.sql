-- ============================================================
--  共養日誌 v2 — migration 010：網頁 Phase 5
--    1) walk_logs   散步日誌（地點/心情/時間）—— 網頁與 LINE 都能增刪改查
--    2) pets.handoff_config  交接卡要顯示哪些區塊（使用者可自訂）
--  在 Supabase SQL Editor 貼上執行一次即可（可安全重複執行）。
-- ============================================================

create table if not exists walk_logs (
  id         bigserial primary key,
  pet_id     bigint not null references pets(id) on delete cascade,
  group_id   text not null,
  place      text,                 -- 地點
  mood       text,                 -- 心情（emoji 或短字）
  note       text,                 -- 備註（選填）
  walked_at  timestamptz default now(),
  by_name    text,
  created_at timestamptz default now()
);
create index if not exists idx_walk_pet on walk_logs(pet_id, walked_at desc);

-- 交接卡顯示設定（null = 全部顯示）。例如 {"basic":true,"tasks":true,"today":true,"weight":true,"health":true,"walks":false,"contact":true}
alter table pets add column if not exists handoff_config jsonb;
