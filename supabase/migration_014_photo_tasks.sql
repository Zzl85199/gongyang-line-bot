-- ============================================================
--  migration_014：任務照片確認機制 + 多張照片一起傳只問一次
-- ============================================================

-- 1) lifebook 加一個 image_set_id：使用者一次選多張照片傳出時，
--    LINE 會把同一批照片標上同一個 imageSet.id，靠這個把「一次傳很多張」
--    的照片群組起來，只問一次要收進哪本圖鑑。
alter table lifebook add column if not exists image_set_id text;
create index if not exists idx_lifebook_image_set on lifebook(image_set_id);

-- 2) 待確認的「任務照片」訊息：小任務卡 / 提醒卡 / 「上傳照片」指令卡 送出後，
--    記住這則訊息的 LINE message id，之後使用者「回覆」這則訊息傳照片，
--    就能明確比對是要完成哪個任務，不會把群組裡其他不相關的照片誤收進來。
create table if not exists pending_photo_tasks (
  id          bigserial primary key,
  group_id    text not null,
  pet_id      bigint not null references pets(id) on delete cascade,
  message_id  text not null,             -- 任務訊息的 LINE message id（給 quotedMessageId 比對）
  task_title  text,                       -- 小任務標題；「上傳照片」指令卡則為 null
  kind        text default 'activity',    -- activity（小任務）| upload_cmd（指令直接上傳）
  created_at  timestamptz default now(),
  expires_at  timestamptz not null
);
create index if not exists idx_pending_task_msg on pending_photo_tasks(message_id);
create index if not exists idx_pending_task_group on pending_photo_tasks(group_id, pet_id, expires_at desc);
