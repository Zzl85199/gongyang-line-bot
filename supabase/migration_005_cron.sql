-- ============================================================
--  共養日誌 v2 — migration 005：開啟「每分鐘推提醒」的排程
--
--  為什麼放這裡而不是 Vercel？
--    Vercel Hobby 方案的 Cron 一天只能跑一次，做不到「每分鐘」檢查提醒，
--    所以每分鐘的排程改由 Supabase 的 pg_cron 來打你部署在 Vercel 的 /api/cron。
--
--  使用步驟（只需做一次）：
--    1) Supabase Dashboard → Database → Extensions，開啟  pg_cron  與  pg_net
--    2) 把下面的  <YOUR_VERCEL_URL>  換成你的網址（例：gongyang.vercel.app，不含結尾斜線）
--    3) 把下面的  <CRON_SECRET>    換成你在 Vercel 環境變數設定的同一組 CRON_SECRET
--       （若你沒有設定 CRON_SECRET，route.js 會放行，但仍建議設一組以免被亂打）
--    4) 在 SQL Editor 整段貼上執行
--
--  之後要停：  select cron.unschedule('gongyang-reminders');
--  看排程：    select * from cron.job;
--  看執行紀錄：select * from cron.job_run_details order by start_time desc limit 20;
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 先移除同名舊排程（可安全重複執行）
select cron.unschedule('gongyang-reminders')
where exists (select 1 from cron.job where jobname = 'gongyang-reminders');

select cron.schedule(
  'gongyang-reminders',
  '* * * * *',  -- 每分鐘
  $$
    select net.http_post(
      url     := 'https://<YOUR_VERCEL_URL>/api/cron',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer <CRON_SECRET>'
      )
    );
  $$
);
