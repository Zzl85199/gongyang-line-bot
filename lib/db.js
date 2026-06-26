// lib/db.js
// 所有資料存取集中在這裡。重點是 markDone / markReminderSent 用「唯一鍵 + ignoreDuplicates」
// 在資料庫層級做原子去重，徹底解決舊版「重送 / 併發 / 重啟」導致的重複打卡與漏發提醒。
import { supa, PHOTO_BUCKET } from './supabase.js';
import { dateKeyTaipei } from './time.js';
import { COLLECTIONS, getCollection } from './collections.js';

// ---------- 照護圈 ----------
export async function getOrCreateGroup(groupId) {
  const { data } = await supa.from('groups').select('*').eq('id', groupId).maybeSingle();
  if (data) return data;
  const { data: created } = await supa
    .from('groups')
    .insert({ id: groupId })
    .select()
    .single();
  return created;
}

export async function setActivePet(groupId, petId) {
  await supa.from('groups').update({ active_pet_id: petId }).eq('id', groupId);
}

// ---------- 寵物（多隻） ----------
export async function listPets(groupId) {
  const { data } = await supa
    .from('pets')
    .select('*')
    .eq('group_id', groupId)
    .eq('archived', false)
    .order('id');
  return data || [];
}

export async function addPet(groupId, name, species = null) {
  await getOrCreateGroup(groupId);
  const { data } = await supa
    .from('pets')
    .insert({ group_id: groupId, name, species })
    .select()
    .single();
  // 如果這是第一隻，順便設為 active
  const g = await getOrCreateGroup(groupId);
  if (!g.active_pet_id) await setActivePet(groupId, data.id);
  return data;
}

export async function findPetByName(groupId, name) {
  const pets = await listPets(groupId);
  if (!name) return null;
  const n = name.trim();
  return pets.find((p) => p.name === n) || pets.find((p) => p.name.includes(n)) || null;
}

// 取「目前對象」：有指定名字就用名字；否則用 active；否則唯一一隻；否則 null
export async function resolvePet(groupId, name) {
  if (name) {
    const byName = await findPetByName(groupId, name);
    if (byName) return byName;
  }
  const pets = await listPets(groupId);
  if (pets.length === 1) return pets[0];
  const g = await getOrCreateGroup(groupId);
  if (g.active_pet_id) {
    const active = pets.find((p) => p.id === g.active_pet_id);
    if (active) return active;
  }
  return null;
}

// ---------- 任務 / 提醒 ----------
export const KIND_META = {
  med: { verb: '餵藥', emoji: '💊' },
  feed: { verb: '餵食', emoji: '🍚' },
  walk: { verb: '散步', emoji: '🦮' },
  custom: { verb: '', emoji: '⏰' },
};

export async function addTask(pet, { kind = 'custom', name, times = [], emoji, dosage = null }) {
  const meta = KIND_META[kind] || KIND_META.custom;
  const { data } = await supa
    .from('tasks')
    .insert({
      pet_id: pet.id,
      group_id: pet.group_id,
      kind,
      name,
      emoji: emoji || meta.emoji,
      times,
      dosage: dosage || null,
    })
    .select()
    .single();
  return data;
}

export async function listTasks(petId) {
  const { data } = await supa
    .from('tasks')
    .select('*')
    .eq('pet_id', petId)
    .eq('active', true)
    .order('id');
  return data || [];
}

export async function listTasksByGroup(groupId) {
  const { data } = await supa
    .from('tasks')
    .select('*')
    .eq('group_id', groupId)
    .eq('active', true)
    .order('id');
  return data || [];
}

export async function getTask(taskId) {
  const { data } = await supa.from('tasks').select('*').eq('id', taskId).maybeSingle();
  return data;
}

export async function removeTask(taskId) {
  await supa.from('tasks').delete().eq('id', taskId);
}

export async function findTaskByName(petId, name) {
  const tasks = await listTasks(petId);
  const n = (name || '').trim();
  return tasks.find((t) => t.name === n) || tasks.find((t) => t.name.includes(n)) || null;
}

// ---------- 打卡（原子去重） ----------
// 回傳 { created, log }。created=true 代表這次是真正第一次打卡；false 代表先前已有人打過。
export async function markDone(task, slot, userId, name) {
  const log_date = dateKeyTaipei();
  const row = {
    task_id: task.id,
    pet_id: task.pet_id,
    group_id: task.group_id,
    log_date,
    scheduled_time: slot,
    done_by_user_id: userId || null,
    done_by_name: name,
  };
  // ignoreDuplicates：撞到 UNIQUE 就不寫，回傳空陣列 → 代表別人先打過了
  const { data } = await supa
    .from('task_logs')
    .upsert(row, { onConflict: 'task_id,log_date,scheduled_time', ignoreDuplicates: true })
    .select();

  if (data && data.length > 0) return { created: true, log: data[0] };

  // 已存在 → 抓出原本那筆（含正確的 done_at，顯示時再轉台北時間）
  const { data: existing } = await supa
    .from('task_logs')
    .select('*')
    .eq('task_id', task.id)
    .eq('log_date', log_date)
    .eq('scheduled_time', slot)
    .maybeSingle();
  return { created: false, log: existing };
}

export async function deleteLog(taskId, slot, logDate = dateKeyTaipei()) {
  const { data } = await supa
    .from('task_logs')
    .delete()
    .eq('task_id', taskId)
    .eq('log_date', logDate)
    .eq('scheduled_time', slot)
    .select();
  return data && data.length > 0;
}

// 今天的打卡狀態（給「今天 / 狀態」用）
export async function todayLogs(groupId) {
  const { data } = await supa
    .from('task_logs')
    .select('*')
    .eq('group_id', groupId)
    .eq('log_date', dateKeyTaipei());
  return data || [];
}

// ---------- 提醒去重（取代記憶體 Set） ----------
// 回傳 true = 這次是第一次發、可以推播；false = 已發過、跳過。
export async function claimReminder(task, slot) {
  const log_date = dateKeyTaipei();
  const { data } = await supa
    .from('reminder_sent')
    .upsert(
      { task_id: task.id, log_date, scheduled_time: slot },
      { onConflict: 'task_id,log_date,scheduled_time', ignoreDuplicates: true }
    )
    .select();
  return Boolean(data && data.length > 0);
}

// ---------- 生命之書 ----------
export async function uploadPhoto(groupId, buffer) {
  const safe = groupId.replace(/[^A-Za-z0-9_-]/g, '_');
  const path = `${safe}/${Date.now()}.jpg`;
  const { error } = await supa.storage
    .from(PHOTO_BUCKET)
    .upload(path, buffer, { contentType: 'image/jpeg', upsert: false });
  if (error) {
    console.error('upload photo failed', error.message);
    return null;
  }
  return path;
}

export async function signedPhotoUrl(path, expiresSec = 60 * 60) {
  if (!path) return null;
  const { data } = await supa.storage.from(PHOTO_BUCKET).createSignedUrl(path, expiresSec);
  return data?.signedUrl || null;
}

export async function addLifebook(pet, entry) {
  const { data } = await supa
    .from('lifebook')
    .insert({ pet_id: pet.id, group_id: pet.group_id, ...entry })
    .select()
    .single();
  return data;
}

export async function recentLifebook(petId, limit = 6) {
  const { data } = await supa
    .from('lifebook')
    .select('*')
    .eq('pet_id', petId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

export async function lifebookCount(petId) {
  const { count } = await supa
    .from('lifebook')
    .select('id', { count: 'exact', head: true })
    .eq('pet_id', petId);
  return count || 0;
}

// ---------- 新增：編輯提醒時間 ----------
export async function updateTaskTimes(taskId, times) {
  const { data } = await supa.from('tasks').update({ times }).eq('id', taskId).select().single();
  return data;
}

// 一次更新時間與/或劑量（edit_reminder、去重更新時用）
export async function updateTaskFields(taskId, fields) {
  const upd = {};
  if (fields.times !== undefined) upd.times = fields.times;
  if (fields.dosage !== undefined) upd.dosage = fields.dosage || null;
  if (!Object.keys(upd).length) return null;
  const { data } = await supa.from('tasks').update(upd).eq('id', taskId).select().single();
  return data;
}

// ---------- 新增：取單筆打卡（過時補提醒判斷用） ----------
export async function getLog(taskId, slot, logDate = dateKeyTaipei()) {
  const { data } = await supa
    .from('task_logs')
    .select('*')
    .eq('task_id', taskId)
    .eq('log_date', logDate)
    .eq('scheduled_time', slot)
    .maybeSingle();
  return data;
}

// ---------- 新增：一次性提醒（順延 / 晚點再提醒） ----------
export async function addOneoff(pet, { label, emoji = null, remindAt, taskId = null, scheduledTime = null }) {
  await supa.from('oneoff_reminders').insert({
    pet_id: pet.id,
    group_id: pet.group_id,
    task_id: taskId,
    scheduled_time: scheduledTime,
    label,
    emoji,
    remind_at: remindAt,
  });
}

export async function dueOneoffs() {
  const nowIso = new Date().toISOString();
  const { data } = await supa
    .from('oneoff_reminders')
    .select('*, pets:pet_id (id, name, group_id, archived)')
    .eq('sent', false)
    .lte('remind_at', nowIso);
  return data || [];
}

export async function markOneoffSent(id) {
  await supa.from('oneoff_reminders').update({ sent: true }).eq('id', id);
}

// ---------- 新增：過時補提醒去重 ----------
export async function claimOverdue(task, slot) {
  const log_date = dateKeyTaipei();
  const { data } = await supa
    .from('overdue_sent')
    .upsert(
      { task_id: task.id, log_date, scheduled_time: slot },
      { onConflict: 'task_id,log_date,scheduled_time', ignoreDuplicates: true }
    )
    .select();
  return Boolean(data && data.length > 0);
}

// ---------- 新增：照護圈設定（過時補提醒 / 輪值） ----------
export async function setOverdueMinutes(groupId, minutes) {
  await supa.from('groups').update({ overdue_minutes: minutes }).eq('id', groupId);
}

export async function setDutyRotation(groupId, names) {
  await supa
    .from('groups')
    .update({ duty_rotation: names, duty_anchor: dateKeyTaipei() })
    .eq('id', groupId);
}

// 依「起算日 + 名單長度」算出今天輪到誰（每天輪一位）
export function dutyToday(group) {
  const rot = group?.duty_rotation || [];
  if (!rot.length) return null;
  const anchorKey = group.duty_anchor || dateKeyTaipei();
  const anchor = new Date(`${anchorKey}T00:00:00+08:00`);
  const today = new Date(`${dateKeyTaipei()}T00:00:00+08:00`);
  const days = Math.floor((today - anchor) / 86400000);
  const idx = ((days % rot.length) + rot.length) % rot.length;
  return rot[idx];
}

export async function allGroupRows() {
  const { data } = await supa.from('groups').select('*');
  return data || [];
}

// ---------- 新增：寵物資料 / 紀念模式 ----------
export async function getPet(petId) {
  const { data } = await supa.from('pets').select('*').eq('id', petId).maybeSingle();
  return data;
}

// 包含已封存（紀念）的寵物 —— 給回顧 / 紀念冊查名字用
export async function listAllPets(groupId) {
  const { data } = await supa.from('pets').select('*').eq('group_id', groupId).order('id');
  return data || [];
}
export async function findPetByNameAny(groupId, name) {
  const pets = await listAllPets(groupId);
  if (!name) return null;
  const n = name.trim();
  return pets.find((p) => p.name === n) || pets.find((p) => p.name.includes(n)) || null;
}

export async function setPetInfo(petId, fields) {
  const upd = {};
  if (fields.birthday !== undefined) upd.birthday = fields.birthday;
  if (fields.health !== undefined) upd.health = fields.health;
  if (fields.species !== undefined) upd.species = fields.species;
  if (!Object.keys(upd).length) return;
  await supa.from('pets').update(upd).eq('id', petId);
}

export async function archivePet(petId) {
  await supa.from('pets').update({ archived: true }).eq('id', petId);
}

// ---------- 新增：月度回顧 ----------
export async function lifebookBetween(petId, sinceIso, untilIso) {
  const { data } = await supa
    .from('lifebook')
    .select('*')
    .eq('pet_id', petId)
    .gte('created_at', sinceIso)
    .lt('created_at', untilIso)
    .order('created_at', { ascending: true });
  return data || [];
}
export async function setLastRecapYm(groupId, ym) {
  await supa.from('groups').update({ last_recap_ym: ym }).eq('id', groupId);
}

// ---------- 新增：AI 對話記憶 ----------
// 存一句對話（role: 'user' | 'assistant'）。內容空白就略過。
export async function saveChatMessage(groupId, role, content) {
  const text = (content || '').trim();
  if (!text) return;
  await supa.from('chat_messages').insert({ group_id: groupId, role, content: text.slice(0, 4000) });
}

// 取最近 N 句，回傳「由舊到新」排序，方便直接塞進模型的對話陣列。
export async function recentChatMessages(groupId, limit = 10) {
  const { data } = await supa
    .from('chat_messages')
    .select('role, content')
    .eq('group_id', groupId)
    .order('id', { ascending: false })
    .limit(limit);
  return (data || []).reverse();
}

// ---------- 新增：照片圖鑑歸類（Phase 2） ----------
export async function setLifebookCollection(entryId, key) {
  const { data } = await supa
    .from('lifebook')
    .update({ collection_key: key })
    .eq('id', entryId)
    .select()
    .single();
  return data;
}

// 某寵物某圖鑑目前累積張數
export async function collectionProgress(petId, key) {
  const { count } = await supa
    .from('lifebook')
    .select('id', { count: 'exact', head: true })
    .eq('pet_id', petId)
    .eq('collection_key', key);
  return count || 0;
}

// 某寵物各圖鑑的張數（回傳 { key: count }），一次撈完在 JS 端統計
export async function collectionCounts(petId) {
  const { data } = await supa
    .from('lifebook')
    .select('collection_key')
    .eq('pet_id', petId)
    .not('collection_key', 'is', null);
  const counts = {};
  for (const row of data || []) counts[row.collection_key] = (counts[row.collection_key] || 0) + 1;
  return counts;
}

// ---------- 新增：照護狀態（Phase 2，安寧期） ----------
// state = 'hospice' 進入安寧；null = 回到自動推導（活力/陪伴/熟齡/療程）
export async function setCareState(petId, state) {
  await supa.from('pets').update({ care_state: state }).eq('id', petId);
}

// ---------- 新增：每週任務去重標記 ----------
export async function setLastTaskWeek(petId, week) {
  await supa.from('pets').update({ last_task_week: week }).eq('id', petId);
}

// ---------- 新增：成員 / 角色（Phase 1 #1，選用） ----------
export async function setRolesEnabled(groupId, enabled) {
  await supa.from('groups').update({ roles_enabled: enabled }).eq('id', groupId);
}

// 學到一位成員（更新名字，但不動既有角色；第一次插入時角色用 DB 預設 caregiver）
export async function upsertMember(groupId, userId, displayName) {
  if (!userId) return null;
  const row = { group_id: groupId, user_id: userId };
  if (displayName) row.display_name = displayName;
  const { data } = await supa
    .from('members')
    .upsert(row, { onConflict: 'group_id,user_id' })
    .select()
    .single();
  return data;
}

export async function getMember(groupId, userId) {
  if (!userId) return null;
  const { data } = await supa
    .from('members')
    .select('*')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .maybeSingle();
  return data;
}

export async function listMembers(groupId) {
  const { data } = await supa.from('members').select('*').eq('group_id', groupId).order('updated_at');
  return data || [];
}

export async function setMemberRole(groupId, userId, role) {
  await supa
    .from('members')
    .upsert({ group_id: groupId, user_id: userId, role, updated_at: new Date().toISOString() }, { onConflict: 'group_id,user_id' });
}

export async function countOwners(groupId) {
  const { count } = await supa
    .from('members')
    .select('user_id', { count: 'exact', head: true })
    .eq('group_id', groupId)
    .eq('role', 'owner');
  return count || 0;
}

export async function findMemberByName(groupId, name) {
  const n = (name || '').trim();
  if (!n) return null;
  const members = await listMembers(groupId);
  return (
    members.find((m) => m.display_name === n) ||
    members.find((m) => m.display_name && m.display_name.includes(n)) ||
    null
  );
}

// ---------- 新增：健康紀錄時間軸（Phase 3 #3） ----------
export async function addHealthLog(pet, { kind, valueNum = null, valueText = null, byName = null }) {
  const { data } = await supa
    .from('health_logs')
    .insert({
      pet_id: pet.id,
      group_id: pet.group_id,
      kind,
      value_num: valueNum,
      value_text: valueText,
      by_name: byName,
    })
    .select()
    .single();
  return data;
}

export async function recentHealthLogs(petId, limit = 12) {
  const { data } = await supa
    .from('health_logs')
    .select('*')
    .eq('pet_id', petId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

// 最近幾筆體重（由新到舊），給趨勢用
export async function weightLogs(petId, limit = 8) {
  const { data } = await supa
    .from('health_logs')
    .select('value_num, created_at')
    .eq('pet_id', petId)
    .eq('kind', 'weight')
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

// ---------- 圖鑑改版：自訂圖鑑 / 中繼資料 / 回顧 ----------
export async function getCollectionMeta(petId, key) {
  const builtin = getCollection(key);
  if (builtin) return builtin;
  if (key && key.startsWith('c')) {
    const id = Number(key.slice(1));
    const { data } = await supa.from('custom_collections').select('*').eq('id', id).maybeSingle();
    if (data && data.pet_id === petId)
      return { key, title: data.title, emoji: data.emoji || '📚', kind: 'series', isCustom: true };
  }
  return null;
}

export async function listCustomCollections(petId) {
  const { data } = await supa.from('custom_collections').select('*').eq('pet_id', petId).order('id');
  return (data || []).map((c) => ({ key: 'c' + c.id, title: c.title, emoji: c.emoji || '📚', kind: 'series', isCustom: true }));
}

export async function addCustomCollection(pet, title, emoji = '📚') {
  const { data } = await supa
    .from('custom_collections')
    .insert({ pet_id: pet.id, group_id: pet.group_id, title, emoji })
    .select()
    .single();
  return { key: 'c' + data.id, title: data.title, emoji: data.emoji || '📚', kind: 'series', isCustom: true };
}

// 全部圖鑑（內建 + 自訂）含張數，給清單與選單用
export async function listAllCollections(petId) {
  const counts = await collectionCounts(petId);
  const builtin = COLLECTIONS.map((c) => ({ ...c, count: counts[c.key] || 0 }));
  const custom = (await listCustomCollections(petId)).map((c) => ({ ...c, count: counts[c.key] || 0 }));
  return [...builtin, ...custom];
}

export async function lifebookByCollection(petId, key, limit = 9) {
  const { data } = await supa
    .from('lifebook')
    .select('*')
    .eq('pet_id', petId)
    .eq('collection_key', key)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

export async function latestLifebookEntry(petId) {
  const rows = await recentLifebook(petId, 1);
  return rows[0] || null;
}

// ---------- 用藥庫存（選填；null = 不追蹤） ----------
export async function setTaskStock(taskId, { count, perDose, threshold } = {}) {
  const upd = {};
  if (count !== undefined) upd.stock_count = count;
  if (perDose !== undefined) upd.stock_per_dose = perDose;
  if (threshold !== undefined) upd.stock_threshold = threshold;
  if (!Object.keys(upd).length) return null;
  const { data } = await supa.from('tasks').update(upd).eq('id', taskId).select().single();
  return data;
}

// 打卡時扣庫存。回傳 null 表示這個任務沒在追蹤庫存。
export async function consumeStock(task) {
  if (task.stock_count == null) return null;
  const per = task.stock_per_dose || 1;
  const prev = task.stock_count;
  const next = Math.max(0, prev - per);
  await supa.from('tasks').update({ stock_count: next }).eq('id', task.id);
  const threshold = task.stock_threshold ?? 5;
  return { prev, next, threshold, crossed: prev > threshold && next <= threshold, empty: next === 0 && prev > 0 };
}

// 取消打卡時補回庫存
export async function restoreStock(task) {
  if (task.stock_count == null) return null;
  const per = task.stock_per_dose || 1;
  const next = task.stock_count + per;
  await supa.from('tasks').update({ stock_count: next }).eq('id', task.id);
  return next;
}

export async function getLifebookEntry(id) {
  const { data } = await supa.from('lifebook').select('*').eq('id', id).maybeSingle();
  return data;
}
