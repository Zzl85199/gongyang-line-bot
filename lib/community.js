// lib/community.js
// 社群功能（跨飼主、公開）的資料存取。獨立成一個檔案，不塞進 db.js，
// 因為這塊是「公開」資料，跟其他都是「私密照護圈」的資料在權限上性質不同。
import { supa, PHOTO_BUCKET } from './supabase.js';

const KINDS = ['post', 'question', 'resource'];
export function normalizeKind(k) {
  return KINDS.includes(k) ? k : 'post';
}

// ---------- 毛孩公開開關 ----------
export async function setPetPublic(petId, isPublic, bio) {
  const upd = { public: Boolean(isPublic) };
  if (bio !== undefined) upd.public_bio = bio || null;
  const { data } = await supa.from('pets').update(upd).eq('id', petId).select().single();
  return data;
}

// 只有標成公開的毛孩才能被社群頁引用；用來擋掉沒開公開卻被亂猜 id 存取的情況
export async function getPublicPet(petId) {
  const { data } = await supa
    .from('pets')
    .select('id, name, species, birthday, public, public_bio')
    .eq('id', petId)
    .eq('public', true)
    .maybeSingle();
  return data;
}

// ---------- 貼文 ----------
export async function createPost({ petId, groupId, authorUserId, authorName, kind, body, region = null, duration = null }) {
  const { data } = await supa
    .from('community_posts')
    .insert({
      pet_id: petId,
      group_id: groupId,
      author_user_id: authorUserId ? String(authorUserId) : null,
      author_name: authorName || null,
      kind: normalizeKind(kind),
      body,
      region,
      duration,
    })
    .select()
    .single();
  return data;
}

export async function setPostPhoto(postId, photoPath) {
  const { data } = await supa.from('community_posts').update({ photo_path: photoPath }).eq('id', postId).select().single();
  return data;
}

export async function getPost(postId) {
  const { data } = await supa.from('community_posts').select('*, pets:pet_id (id, name, species, public)').eq('id', postId).maybeSingle();
  return data;
}

export async function deletePost(postId) {
  await supa.from('community_posts').delete().eq('id', postId);
}

// 社群首頁動態牆：依類型篩選（'all' 或 post/question/resource），只顯示公開毛孩的貼文
export async function listPosts({ kind = 'all', limit = 30, before = null } = {}) {
  let q = supa
    .from('community_posts')
    .select('*, pets:pet_id (id, name, species, public)')
    .eq('pets.public', true)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (kind !== 'all') q = q.eq('kind', normalizeKind(kind));
  if (before) q = q.lt('created_at', before);
  const { data } = await q;
  // Supabase 對 join 條件的 filter 有時對 null 關聯處理不同，這裡再保險過濾一次
  return (data || []).filter((p) => p.pets && p.pets.public);
}

export async function listPostsByPet(petId, limit = 30) {
  const { data } = await supa
    .from('community_posts')
    .select('*')
    .eq('pet_id', petId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

export async function signedCommunityPhotoUrl(path, expiresSec = 3600) {
  if (!path) return null;
  const { data } = await supa.storage.from(PHOTO_BUCKET).createSignedUrl(path, expiresSec);
  return data?.signedUrl || null;
}

export async function uploadCommunityPhoto(groupId, buffer, contentType = 'image/jpeg') {
  const safe = String(groupId).replace(/[^A-Za-z0-9_-]/g, '_');
  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : contentType === 'image/gif' ? 'gif' : 'jpg';
  const path = `community/${safe}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supa.storage.from(PHOTO_BUCKET).upload(path, buffer, { contentType: contentType || 'image/jpeg', upsert: false });
  if (error) {
    console.error('community photo upload failed', error.message);
    return null;
  }
  return path;
}

// ---------- 留言 ----------
export async function listComments(postId) {
  const { data } = await supa.from('community_comments').select('*').eq('post_id', postId).order('created_at', { ascending: true });
  return data || [];
}

export async function addComment(postId, { authorUserId, authorName, body }) {
  const { data } = await supa
    .from('community_comments')
    .insert({ post_id: postId, author_user_id: authorUserId ? String(authorUserId) : null, author_name: authorName || null, body })
    .select()
    .single();
  return data;
}

export async function deleteComment(commentId) {
  await supa.from('community_comments').delete().eq('id', commentId);
}

export async function getComment(commentId) {
  const { data } = await supa.from('community_comments').select('*').eq('id', commentId).maybeSingle();
  return data;
}

// ---------- 按讚 ----------
export async function likeCounts(postIds) {
  if (!postIds.length) return {};
  const { data } = await supa.from('community_likes').select('post_id').in('post_id', postIds);
  const counts = {};
  for (const row of data || []) counts[row.post_id] = (counts[row.post_id] || 0) + 1;
  return counts;
}

export async function likedPostIds(postIds, userId) {
  if (!postIds.length || !userId) return new Set();
  const { data } = await supa.from('community_likes').select('post_id').in('post_id', postIds).eq('user_id', String(userId));
  return new Set((data || []).map((r) => r.post_id));
}

// 回傳切換後的狀態：{ liked: true/false, count }
export async function toggleLike(postId, userId) {
  const uid = String(userId);
  const { data: existing } = await supa.from('community_likes').select('id').eq('post_id', postId).eq('user_id', uid).maybeSingle();
  if (existing) {
    await supa.from('community_likes').delete().eq('id', existing.id);
  } else {
    await supa.from('community_likes').upsert({ post_id: postId, user_id: uid }, { onConflict: 'post_id,user_id', ignoreDuplicates: true });
  }
  const { count } = await supa.from('community_likes').select('id', { count: 'exact', head: true }).eq('post_id', postId);
  return { liked: !existing, count: count || 0 };
}
