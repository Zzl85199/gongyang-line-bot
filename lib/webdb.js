// lib/webdb.js
// 網頁後台的資料存取。沿用 lib/db.js（機器人在用的同一套）做寵物/任務/成員讀取，
// 這裡只補「帳號」與「對外授權」相關的查詢，以及把兩者合起來算出「有效角色」。
import { supa } from './supabase.js';
import * as db from './db.js';

// ---------- app_users ----------
export async function getAppUserById(id) {
  if (!id) return null;
  const { data } = await supa.from('app_users').select('*').eq('id', id).maybeSingle();
  return data;
}
export async function getAppUserByLineId(lineId) {
  if (!lineId) return null;
  const { data } = await supa.from('app_users').select('*').eq('line_user_id', lineId).maybeSingle();
  return data;
}
export async function getAppUserByEmail(email) {
  const e = (email || '').trim().toLowerCase();
  if (!e) return null;
  const { data } = await supa.from('app_users').select('*').eq('email', e).maybeSingle();
  return data;
}
export async function createEmailUser({ email, passwordHash, displayName }) {
  const { data, error } = await supa
    .from('app_users')
    .insert({ email: (email || '').trim().toLowerCase(), password_hash: passwordHash, display_name: displayName || null })
    .select()
    .single();
  if (error) throw error;
  return data;
}
// LINE 登入：已有同 line_user_id 就更新名字，否則建立（同 provider 時即自動對上 members）
export async function upsertLineUser({ lineUserId, displayName }) {
  const existing = await getAppUserByLineId(lineUserId);
  if (existing) {
    if (displayName && displayName !== existing.display_name)
      await supa.from('app_users').update({ display_name: displayName }).eq('id', existing.id);
    return existing;
  }
  const { data } = await supa
    .from('app_users')
    .insert({ line_user_id: lineUserId, display_name: displayName || null })
    .select()
    .single();
  return data;
}

// ---------- 有效角色解析 ----------
// 規則：LINE 群成員（members 有這個 line_user_id）→ 預設 owner（主飼主）。
//       否則看 access_grants（已兌換 redeemed_at）→ 用 grant 的角色（獸醫等）。
export async function effectiveAccess(groupId, user) {
  if (!user || !groupId) return null;
  if (user.line_user_id) {
    const { data: m } = await supa
      .from('members')
      .select('user_id, role, display_name')
      .eq('group_id', groupId)
      .eq('user_id', user.line_user_id)
      .maybeSingle();
    if (m) return { role: 'owner', source: 'line', member: m };
  }
  const { data: g } = await supa
    .from('access_grants')
    .select('*')
    .eq('group_id', groupId)
    .eq('app_user_id', user.id)
    .not('redeemed_at', 'is', null)
    .order('id', { ascending: false })
    .maybeSingle();
  if (g) return { role: g.role, source: 'grant', grant: g };
  return null;
}

const LEVEL = { vet: 0, viewer: 0, caregiver: 1, owner: 2 };
export function canManage(access) {
  return Boolean(access) && (LEVEL[access.role] ?? -1) >= 2;
}
export function canCheckin(access) {
  return Boolean(access) && (LEVEL[access.role] ?? -1) >= 1;
}

// 使用者能看到的所有照護圈（含角色與寵物，當清單/標題用）
export async function accessibleGroups(user) {
  if (!user) return [];
  const map = new Map(); // groupId -> { groupId, role, source }
  if (user.line_user_id) {
    const { data: ms } = await supa.from('members').select('group_id').eq('user_id', user.line_user_id);
    for (const m of ms || []) map.set(m.group_id, { groupId: m.group_id, role: 'owner', source: 'line' });
  }
  const { data: gs } = await supa
    .from('access_grants')
    .select('group_id, role')
    .eq('app_user_id', user.id)
    .not('redeemed_at', 'is', null);
  for (const g of gs || []) if (!map.has(g.group_id)) map.set(g.group_id, { groupId: g.group_id, role: g.role, source: 'grant' });

  const out = [];
  for (const v of map.values()) {
    const pets = await db.listAllPets(v.groupId);
    out.push({ ...v, pets, label: petsLabel(pets) });
  }
  return out;
}
export function petsLabel(pets) {
  const names = (pets || []).map((p) => p.name);
  if (!names.length) return '照護圈';
  if (names.length <= 2) return names.join('・') + ' 的照護圈';
  return `${names.slice(0, 2).join('・')} 等 ${names.length} 隻的照護圈`;
}

// ---------- 對外授權（獸醫 / 保母） ----------
export async function listGrants(groupId) {
  const { data } = await supa.from('access_grants').select('*').eq('group_id', groupId).order('id');
  return data || [];
}
export async function createGrant({ groupId, email, role, token, createdBy }) {
  const { data } = await supa
    .from('access_grants')
    .insert({
      group_id: groupId,
      email: (email || '').trim().toLowerCase() || null,
      role: role || 'viewer',
      token,
      created_by: createdBy || null,
    })
    .select()
    .single();
  return data;
}
export async function revokeGrant(id, groupId) {
  await supa.from('access_grants').delete().eq('id', id).eq('group_id', groupId);
}
export async function getGrantByToken(token) {
  if (!token) return null;
  const { data } = await supa.from('access_grants').select('*').eq('token', token).maybeSingle();
  return data;
}
export async function redeemGrant(grant, appUserId) {
  await supa
    .from('access_grants')
    .update({ app_user_id: appUserId, redeemed_at: new Date().toISOString() })
    .eq('id', grant.id);
}
