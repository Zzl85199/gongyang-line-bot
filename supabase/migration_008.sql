-- ============================================================
--  共養日誌 v2 — migration 008
--  #2 圖鑑改版：自訂圖鑑（custom_collections）
--  #3 庫存提醒：用藥可選填存量（不填則無任何庫存行為，不強制）
--  在 Supabase SQL Editor 貼上執行一次即可（可安全重複執行）。
-- ============================================================

-- 用藥庫存（全部選填）：stock_count 為 null = 沒在追蹤庫存，行為跟現在完全一樣。
--   stock_count    目前剩餘量（顆/ml…）
--   stock_per_dose 每次給藥扣多少（預設 1）
--   stock_threshold 低於等於這個數就提醒補貨（預設 5）
alter table tasks add column if not exists stock_count    int;
alter table tasks add column if not exists stock_per_dose int default 1;
alter table tasks add column if not exists stock_threshold int default 5;

-- 自訂圖鑑：使用者自己開的收集系列（如「復健紀錄」「跟妹妹的合照」）。
-- 照片歸屬時 lifebook.collection_key 會存成 'c' || id。
create table if not exists custom_collections (
  id          bigserial primary key,
  pet_id      bigint not null references pets(id) on delete cascade,
  group_id    text,
  title       text not null,
  emoji       text default '📚',
  created_at  timestamptz default now()
);
create index if not exists idx_custom_coll_pet on custom_collections(pet_id);
