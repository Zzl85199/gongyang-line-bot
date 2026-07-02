-- ============================================================
--  共養日誌 v3 — migration 013：walk_logs 補上 task_id / scheduled_time
--    目的：讓「散步」提醒卡打卡 ✅ 時，也能同步寫一筆 walk_logs（解決統計頁
--    「散步次數」卡在 0 的 bug），並且在按「誤觸？取消這筆」時，能準確找回
--    剛剛那筆自動產生的散步紀錄一併刪除，避免統計對不起來。
--    對既有資料完全不影響：欄位皆為 nullable，手動用「遛/散步」指令記錄的
--    散步日誌不受影響（task_id 維持 null）。
--  在 Supabase SQL Editor 貼上執行一次即可（可安全重複執行）。
-- ============================================================

alter table walk_logs add column if not exists task_id bigint references tasks(id) on delete set null;
alter table walk_logs add column if not exists scheduled_time text;
create index if not exists idx_walk_task on walk_logs(task_id, scheduled_time);
