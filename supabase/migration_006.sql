-- ============================================================
--  共養日誌 v2 — migration 006（Phase 1 + Phase 2）
--  Phase 1：用藥劑量結構化
--  Phase 2：寵物照護狀態（安寧）、每週任務推送去重、照片圖鑑歸類
--  在 Supabase SQL Editor 貼上執行一次即可（可安全重複執行）。
-- ============================================================

-- Phase 1：劑量獨立成欄位，別再塞在 name 字串裡（之後會長成病史）
alter table tasks add column if not exists dosage text;

-- Phase 2：寵物照護狀態
--   care_state = null  → 由系統依年齡/病況自動推導（活力/陪伴/熟齡/療程）
--   care_state = 'hospice' → 安寧期（飼主手動、需確認）：仍發藥物提醒，但不自動丟任務、不慶祝
--   紀念期沿用既有的 pets.archived = true
alter table pets add column if not exists care_state text;

-- Phase 2：每週自動任務的「已推週次」標記（如 2026-W26），避免一個下午重複推
alter table pets add column if not exists last_task_week text;

-- Phase 2：照片可歸到某個「圖鑑系列」（睡姿圖鑑、表情包…）。null = 只放在生命之書
alter table lifebook add column if not exists collection_key text;
create index if not exists idx_lifebook_collection on lifebook(pet_id, collection_key);
