// lib/db.js
// 所有資料存取集中在這裡。重點是 markDone / markReminderSent 用「唯一鍵 + ignoreDuplicates」
// 在資料庫層級做原子去重，徹底解決舊版「重送 / 併發 / 重啟」導致的重複打卡與漏發提醒。
import { supa, PHOTO_BUCKET } from './supabase.js';
import { dateKeyTaipei } from './time.js';

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

export async function addTask(pet, { kind = 'custom', name, times = [], emoji }) {
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
  await supa.from('lifebook').insert({
    pet_id: pet.id,
    group_id: pet.group_id,
    ...entry,
  });
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
