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
