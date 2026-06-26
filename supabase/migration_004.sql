-- ============================================================
--  共養日誌 v2 — migration 004
--  新增：AI 對話記憶（讓小幫手記得這個照護圈最近聊過什麼）
--  在 Supabase SQL Editor 貼上執行一次即可（可安全重複執行）。
-- ============================================================

-- 每個照護圈（group）一串對話。role = 'user' | 'assistant'。
-- 只存「進到 AI 的那一句」與「AI 的文字回覆」，工具呼叫的中間過程不入庫。
create table if not exists chat_messages (
  id          bigserial primary key,
  group_id    text not null references groups(id) on delete cascade,
  role        text not null,                 -- user | assistant
  content     text not null,
  created_at  timestamptz default now()
);
create index if not exists idx_chat_group_time on chat_messages(group_id, created_at desc);
