-- ============================================================
--  共養日誌 v2 — migration 003
--  新增：寵物年齡/健康（自動調整活動建議用）＋月度回顧紀錄
--  在 Supabase SQL Editor 貼上執行一次即可（可安全重複執行）。
-- ============================================================

alter table pets   add column if not exists birthday date;   -- 用於推算生命階段
alter table pets   add column if not exists health   text;    -- 病況描述，例如「腎臟病、關節退化」
alter table groups add column if not exists last_recap_ym text; -- 已發過月度回顧的年月，如 2026-07
