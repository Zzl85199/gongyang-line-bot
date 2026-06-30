-- ============================================================
--  共養日誌 v2 — migration 011：照護圈時區
--  讓每個照護圈可設自己的時區（預設台北）。提醒到點比對改用這個時區，
--  解決「狗狗不在台灣 / 使用者在不同國家」時提醒時間錯亂的問題。
--  在 Supabase SQL Editor 貼上執行一次即可（可安全重複執行）。
-- ============================================================

alter table groups add column if not exists timezone text default 'Asia/Taipei';

-- 既有資料補上預設值（避免舊資料是 NULL）
update groups set timezone = 'Asia/Taipei' where timezone is null;
