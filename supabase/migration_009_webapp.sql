-- ============================================================
--  共養日誌 v2 — migration 009：網頁後台（帳號 + 對外授權）
--
--  做什麼：
--    1) app_users    網頁帳號（LINE 登入 / Email 註冊都存這裡）
--    2) access_grants 對外授權（把網頁開放給不在 LINE 群裡的人，例如獸醫）
--    3) 從現有 members 回填 app_users：之後家人用「同一個 LINE 帳號」登入就自動對上、立即有權限
--
--  關鍵設計（也是「更好的辦法」）：
--    - 只要 LINE Login channel 跟你的 Messaging API channel 在「同一個 Provider」底下，
--      LINE 回傳的 userId 會和機器人看到的 userId 一致 → 一登入就自動對上 members，
--      不必再做任何邀請。群裡的人預設視為 owner（主飼主），能管排程也能開授權。
--    - 群外的人（獸醫、保母）由 owner 產生一條「邀請連結」授權，可隨時撤銷，預設唯讀。
--
--  在 Supabase SQL Editor 貼上執行一次即可（可安全重複執行）。
-- ============================================================

create table if not exists app_users (
  id            bigserial primary key,
  line_user_id  text unique,                 -- 與 Messaging API 同 provider 時即 members.user_id
  email         text unique,
  password_hash text,                        -- Email 註冊才有；LINE 登入為 null
  display_name  text,
  created_at    timestamptz default now()
);

create table if not exists access_grants (
  id          bigserial primary key,
  group_id    text not null references groups(id) on delete cascade,
  email       text,                          -- 邀請對象（選填，方便辨識）
  app_user_id bigint references app_users(id) on delete cascade, -- 兌換後綁定的帳號
  role        text not null default 'viewer',-- owner | caregiver | viewer | vet(視同唯讀，但標示為獸醫)
  token       text unique,                   -- 邀請連結用的一次性 token
  created_by  text,                          -- 哪位 owner 開的（顯示用）
  created_at  timestamptz default now(),
  redeemed_at timestamptz                    -- 已被某帳號兌換的時間（null = 尚未啟用）
);
create index if not exists idx_grant_group on access_grants(group_id);
create index if not exists idx_grant_user  on access_grants(app_user_id);
create index if not exists idx_grant_email on access_grants(lower(email));

-- 從現有 LINE 成員回填網頁帳號（同 LINE 帳號登入即自動對上、立即有權限）
insert into app_users (line_user_id, display_name)
select m.user_id, max(m.display_name)
from members m
where m.user_id is not null
  and not exists (select 1 from app_users u where u.line_user_id = m.user_id)
group by m.user_id
on conflict (line_user_id) do nothing;
