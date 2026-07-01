-- ============================================================
--  共養日誌 v2 — migration 012：社群（公開，跨飼主）
--  新增：毛孩「公開到社群」開關 + 簡介；動態／問答／找保母送養合併成一個
--  貼文資料表（用 kind 分類，不用三張表），加留言、按讚。
--  在 Supabase SQL Editor 貼上執行一次即可（可安全重複執行）。
-- ============================================================

-- 1. 毛孩檔案加「公開到社群」開關與公開簡介 -------------------
alter table pets add column if not exists public boolean not null default false;
alter table pets add column if not exists public_bio text;

-- 2. 社群貼文（動態 / 問答 / 找保母送養，共用同一張表） ---------
create table if not exists community_posts (
  id              bigserial primary key,
  pet_id          bigint not null references pets(id) on delete cascade,
  group_id        text not null,             -- 方便權限檢查（發文者所屬照護圈）
  author_user_id  text,                       -- app_users.id，刪文權限判斷用
  author_name     text,
  kind            text not null default 'post', -- post | question | resource
  body            text not null,
  photo_path      text,                       -- 存在同一個 lifebook bucket，路徑前綴 community/
  region          text,                       -- 找保母/送養才用
  duration        text,                       -- 找保母/送養才用（例：長期 / 3 天 / 2026-07-10~07-13）
  created_at      timestamptz default now()
);
create index if not exists idx_community_posts_created on community_posts(created_at desc);
create index if not exists idx_community_posts_kind on community_posts(kind);
create index if not exists idx_community_posts_pet on community_posts(pet_id);

-- 3. 留言（扁平一層，不做巢狀回覆） -----------------------------
create table if not exists community_comments (
  id              bigserial primary key,
  post_id         bigint not null references community_posts(id) on delete cascade,
  author_user_id  text,
  author_name     text,
  body            text not null,
  created_at      timestamptz default now()
);
create index if not exists idx_community_comments_post on community_comments(post_id);

-- 4. 按讚（同一人同一篇只能讚一次） ------------------------------
create table if not exists community_likes (
  id          bigserial primary key,
  post_id     bigint not null references community_posts(id) on delete cascade,
  user_id     text not null,
  created_at  timestamptz default now(),
  unique (post_id, user_id)
);
create index if not exists idx_community_likes_post on community_likes(post_id);
