// lib/handlers.js
// LINE 事件路由。文字指令是「確定性」的（不靠 AI 也能全功能）；AI 是加在上面的自然語言層。
import * as line from './line.js';
import * as db from './db.js';
import * as msg from './messages.js';
import * as ai from './ai.js';
import { parseTimes } from './time.js';
import { suggestActivity } from './activities.js';
import { albumUrl } from './album.js';
import * as collections from './collections.js';
import { careTone } from './petstate.js';

function sourceId(event) {
  const s = event.source;
  return s.groupId || s.roomId || s.userId;
}

export async function handleEvent(event) {
  try {
    if (event.type === 'join' || event.type === 'follow') {
      return line.reply(event.replyToken, msg.welcome());
    }
    if (event.type === 'postback') return handlePostback(event);
    if (event.type === 'message' && event.message.type === 'text')
      return handleText(event, event.message.text.trim(), event.message.mention);
    if (event.type === 'message' && event.message.type === 'image') return handleImage(event);
  } catch (e) {
    console.error('handleEvent error', e);
  }
  return null;
}

// 是否要交給 AI：喚醒詞開頭，或 @ 提到了機器人本身
function aiTrigger(text, mention, wakeWord) {
  const mentionedSelf = mention?.mentionees?.some((m) => m.isSelf);
  if (mentionedSelf) return text.replace(/@\S+/g, '').trim();
  if (wakeWord && text.startsWith(wakeWord)) return text.slice(wakeWord.length).trim();
  // 也接受常見的喚醒詞
  for (const w of ['小幫手', '助手', '共養']) {
    if (text.startsWith(w)) return text.slice(w.length).trim();
  }
  return null;
}

async function handleText(event, t, mention) {
  const gid = sourceId(event);
  const group = await db.getOrCreateGroup(gid);

  if (/^(幫助|help|指令)$/i.test(t)) return line.reply(event.replyToken, msg.help(group.wake_word));

  // ---- 寵物 ----
  let m;
  if ((m = t.match(/^(?:新增寵物|綁定)\s*(.+)$/))) {
    const pet = await db.addPet(gid, m[1].trim());
    return line.reply(
      event.replyToken,
      msg.text(`好的，已加入毛孩：${pet.name} 🐾\n可以「新增用藥 ${pet.name} 藥名 08:00,20:00」設定提醒，或用「切換 ${pet.name}」設成預設對象。`)
    );
  }
  if (/^寵物清單$/.test(t)) {
    const pets = await db.listPets(gid);
    if (!pets.length) return line.reply(event.replyToken, msg.text('還沒有任何毛孩，先「新增寵物 名字」吧。'));
    const active = pets.find((p) => p.id === group.active_pet_id);
    const list = pets.map((p) => `・${p.name}${p.id === group.active_pet_id ? '（預設）' : ''}`).join('\n');
    return line.reply(event.replyToken, msg.text(`目前的毛孩：\n${list}` + (active ? '' : '\n\n用「切換 名字」設定預設對象。')));
  }
  if ((m = t.match(/^(?:切換|選)\s*(.+)$/))) {
    const pet = await db.findPetByName(gid, m[1].trim());
    if (!pet) return line.reply(event.replyToken, msg.text(`找不到「${m[1].trim()}」，先「新增寵物」吧。`));
    await db.setActivePet(gid, pet.id);
    return line.reply(event.replyToken, msg.text(`好，之後沒特別指定就是 ${pet.name} 🐾`));
  }

  // ---- 新增提醒（餵藥 / 餵食 / 散步 / 自訂） ----
  // 格式：新增用藥 [寵物] 名稱 時間  /  新增散步 [寵物] [名稱] 時間
  const kindMap = { 用藥: 'med', 餵藥: 'med', 餵食: 'feed', 吃飯: 'feed', 散步: 'walk', 提醒: 'custom' };
  if ((m = t.match(/^新增(用藥|餵藥|餵食|吃飯|散步|提醒)\s+(.+)$/))) {
    const kind = kindMap[m[1]];
    const rest = m[2].trim();
    const parsed = await parseAddReminder(gid, kind, rest);
    if (parsed.error) return line.reply(event.replyToken, msg.text(parsed.error));
    const task = await db.addTask(parsed.pet, { kind, name: parsed.name, times: parsed.times });
    return line.reply(
      event.replyToken,
      msg.text(`已為 ${parsed.pet.name} 新增「${task.name}」（${parsed.times.join('、')}）\n到時間我會在群裡提醒。`)
    );
  }

  if (/^(提醒清單|用藥清單)$/.test(t)) {
    const pets = await db.listPets(gid);
    if (!pets.length) return line.reply(event.replyToken, msg.text('還沒有毛孩，也還沒有提醒。'));
    const lines = [];
    for (const pet of pets) {
      const tasks = await db.listTasks(pet.id);
      lines.push(`🐾 ${pet.name}`);
      if (!tasks.length) lines.push('　（無）');
      else tasks.forEach((tk) => lines.push(`　・${tk.name}${tk.dosage ? `（劑量：${tk.dosage}）` : ''}（${tk.times.join('、')}）`));
    }
    return line.reply(event.replyToken, msg.text(lines.join('\n')));
  }

  if ((m = t.match(/^刪除提醒\s+(.+)$/))) {
    const pet = await db.resolvePet(gid, null);
    if (!pet) return line.reply(event.replyToken, msg.text('請先「切換」到某隻毛孩，再刪除提醒。'));
    const task = await db.findTaskByName(pet.id, m[1].trim());
    if (!task) return line.reply(event.replyToken, msg.text(`找不到「${m[1].trim()}」這個提醒。`));
    await db.removeTask(task.id);
    return line.reply(event.replyToken, msg.text(`已刪除提醒：${task.name}`));
  }

  // ---- 今日狀態（需求 7） ----
  if (/^(今天|今日|狀態)$/.test(t)) {
    const pets = await db.listPets(gid);
    if (!pets.length) return line.reply(event.replyToken, msg.text('還沒有毛孩可以看狀態。'));
    const tasksByPet = {};
    for (const p of pets) tasksByPet[p.id] = await db.listTasks(p.id);
    const logs = await db.todayLogs(gid);
    return line.reply(event.replyToken, msg.todayStatus(pets, tasksByPet, logs, db.dutyToday(group)));
  }

  // ---- 輪值名單（文字版；AI 也能做） 輪值 爸 媽 我 ----
  if ((m = t.match(/^輪值\s+(.+)$/))) {
    const names = m[1].split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!names.length) return line.reply(event.replyToken, msg.text('請給名單，例如「輪值 爸 媽 我」。'));
    await db.setDutyRotation(gid, names);
    return line.reply(event.replyToken, msg.text(`好，輪值順序：${names.join(' → ')}，從今天起每天輪一位 🙋`));
  }

  // ---- 過時補提醒（文字版） 過時提醒 30 / 關閉過時提醒 ----
  if ((m = t.match(/^過時提醒\s*(\d+)$/))) {
    const mins = parseInt(m[1], 10);
    await db.setOverdueMinutes(gid, mins);
    return line.reply(event.replyToken, msg.text(`好，超過 ${mins} 分鐘沒打卡我會補提醒一次。`));
  }
  if (/^關閉過時提醒$/.test(t)) {
    await db.setOverdueMinutes(gid, 0);
    return line.reply(event.replyToken, msg.text('好，已關閉過時補提醒。'));
  }

  // ---- 取消誤觸打卡（需求 8，文字版） 取消 早餐 07:00 ----
  if ((m = t.match(/^取消\s+(\S+)\s+(\d{1,2}[:：]\d{2})$/))) {
    const pet = await db.resolvePet(gid, null);
    if (!pet) return line.reply(event.replyToken, msg.text('請先「切換」到某隻毛孩。'));
    const task = await db.findTaskByName(pet.id, m[1]);
    if (!task) return line.reply(event.replyToken, msg.text(`找不到「${m[1]}」這個提醒。`));
    const slot = parseTimes(m[2])[0];
    const ok = await db.deleteLog(task.id, slot);
    return line.reply(
      event.replyToken,
      msg.text(ok ? `已取消 ${task.name} ${slot} 的打卡，等等會再提醒。` : `今天 ${slot} 沒有 ${task.name} 的打卡紀錄。`)
    );
  }

  // ---- 生命之書回顧（需求 6） ----
  if ((m = t.match(/^(?:生命之書|回顧)\s*(.*)$/))) {
    const nm = m[1].trim();
    const pet = nm ? await db.findPetByNameAny(gid, nm) : await db.resolvePet(gid, null);
    if (!pet) return line.reply(event.replyToken, msg.text('請先「切換」到某隻毛孩，或「回顧 名字」。'));
    const entries = await db.recentLifebook(pet.id, 8);
    if (!entries.length)
      return line.reply(event.replyToken, msg.text(`${pet.name} 的生命之書還是空的 📖\n把照片傳進群組就是第一頁。`));
    const urls = await Promise.all(entries.map((e) => db.signedPhotoUrl(e.photo_path)));
    const count = await db.lifebookCount(pet.id);
    return line.reply(event.replyToken, [
      msg.text(`📖 ${pet.name} 的生命之書，已收藏 ${count} 個時光，最近這些：`),
      msg.lifebookCarousel(pet, entries, urls),
    ]);
  }

  // ---- 紀念冊連結（可保存 / 自動播放） ----
  if ((m = t.match(/^(?:紀念冊|相簿|相冊)\s*(.*)$/))) {
    const nm = m[1].trim();
    const pet = nm ? await db.findPetByNameAny(gid, nm) : await db.resolvePet(gid, null);
    if (!pet) return line.reply(event.replyToken, msg.text('請「紀念冊 名字」，或先切換到某隻毛孩。'));
    const url = albumUrl(pet.id);
    if (!url.startsWith('http'))
      return line.reply(event.replyToken, msg.text('紀念冊連結還缺網址設定（請在 Vercel 環境變數設 PUBLIC_BASE_URL）。'));
    return line.reply(event.replyToken, msg.text(`📖 ${pet.name} 的紀念冊（可保存、會自動播放）：\n${url}`));
  }

  // ---- 活動建議（依年齡/病況自動調整） ----
  if (/^(任務|活動|來個任務|今日任務|建議活動)$/.test(t)) {
    const pet = await db.resolvePet(gid, null);
    if (!pet) return line.reply(event.replyToken, msg.text('先「新增寵物」或「切換 名字」，再來個小任務吧 🐾'));
    return line.reply(event.replyToken, msg.activitySuggestion(pet, suggestActivity(pet)));
  }

  // ---- 紀念模式（先確認） 紀念 旺旺 ----
  if ((m = t.match(/^紀念\s+(.+)$/))) {
    const pet = await db.findPetByNameAny(gid, m[1].trim());
    if (!pet) return line.reply(event.replyToken, msg.text(`找不到「${m[1].trim()}」。`));
    return line.reply(
      event.replyToken,
      msg.confirmCard(`要為 ${pet.name} 開啟紀念模式嗎？之後不會再傳牠的提醒，但回憶都會保留。`, '開啟紀念模式', `a=memorial&t=${pet.id}`)
    );
  }

  // ---- 圖鑑進度（Phase 2） 圖鑑 / 收集冊 [名字] ----
  if ((m = t.match(/^(?:圖鑑|收集冊|收藏冊)\s*(.*)$/))) {
    const nm = m[1].trim();
    const pet = nm ? await db.findPetByNameAny(gid, nm) : await db.resolvePet(gid, null);
    if (!pet) return line.reply(event.replyToken, msg.text('請「圖鑑 名字」，或先切換到某隻毛孩。'));
    const counts = await db.collectionCounts(pet.id);
    return line.reply(event.replyToken, msg.collectionsList(pet, counts));
  }

  // ---- 安寧期（重大轉換，先溫柔確認） 安寧 哈吉 ----
  if ((m = t.match(/^安寧\s+(.+)$/))) {
    const pet = await db.findPetByNameAny(gid, m[1].trim());
    if (!pet) return line.reply(event.replyToken, msg.text(`找不到「${m[1].trim()}」。`));
    return line.reply(
      event.replyToken,
      msg.confirmCard(
        `要把 ${pet.name} 切到安寧期嗎？藥物提醒會照常，但不再丟活動任務、也不會有慶祝。`,
        '進入安寧期',
        `a=hospice&t=${pet.id}`
      )
    );
  }

  // ---- 結束安寧 / 恢復照護 名字 ----
  if ((m = t.match(/^(?:恢復照護|結束安寧|解除安寧)\s+(.+)$/))) {
    const pet = await db.findPetByNameAny(gid, m[1].trim());
    if (!pet) return line.reply(event.replyToken, msg.text(`找不到「${m[1].trim()}」。`));
    await db.setCareState(pet.id, null);
    return line.reply(event.replyToken, msg.restoreMessage(pet));
  }

  // ---- AI 自然語言（需求 5：聊天室觸發） ----
  const aiText = aiTrigger(t, mention, group.wake_word);
  if (aiText !== null) {
    const out = await ai.handleAI(gid, aiText);
    return line.reply(event.replyToken, out);
  }

  // 其他訊息不回應，避免在群組製造噪音
  return null;
}

// 解析「[寵物] 名稱 時間…」這種彈性輸入
async function parseAddReminder(gid, kind, rest) {
  const tokens = rest.split(/\s+/);
  // 先看第一個 token 是不是寵物名
  let pet = await db.findPetByName(gid, tokens[0]);
  let nameTokens = tokens;
  if (pet) nameTokens = tokens.slice(1);
  else pet = await db.resolvePet(gid, null);
  if (!pet) return { error: '不確定是哪隻毛孩，先「新增寵物」或「切換 名字」。' };

  // 把結尾連續的時間 token 抓出來，剩下的當名稱
  const times = [];
  const nameParts = [];
  for (const tok of nameTokens) {
    const tt = parseTimes(tok);
    if (tt.length) times.push(...tt);
    else nameParts.push(tok);
  }
  if (!times.length) return { error: '看不懂時間，請用像「08:00,20:00」這樣的格式。' };
  const defaults = { med: '用藥', feed: '餵食', walk: '散步', custom: '提醒' };
  const name = nameParts.join(' ') || defaults[kind];
  return { pet, name, times };
}

async function handlePostback(event) {
  const gid = sourceId(event);
  const data = new URLSearchParams(event.postback.data);
  const action = data.get('a');
  const taskId = Number(data.get('t'));
  const slot = data.get('s');

  if (action === 'done') {
    const task = await db.getTask(taskId);
    if (!task) return line.reply(event.replyToken, msg.text('這個提醒已經不存在了。'));
    const name = await line.getDisplayName(event.source);
    const { created, log } = await db.markDone(task, slot, event.source.userId, name);
    if (created) return line.reply(event.replyToken, msg.doneConfirm(name, task, slot));
    return line.reply(event.replyToken, msg.alreadyDone(log, task, slot)); // 顯示正確台北時間
  }

  if (action === 'undo') {
    const task = await db.getTask(taskId);
    if (!task) return line.reply(event.replyToken, msg.text('這個提醒已經不存在了。'));
    const ok = await db.deleteLog(taskId, slot);
    return line.reply(
      event.replyToken,
      msg.text(ok ? `已取消 ${task.name} ${slot} 的打卡，稍後會再提醒。` : '這筆打卡已經不在了。')
    );
  }

  // 刪除提醒（AI 確認卡按下「確認刪除」）
  if (action === 'delrem') {
    const task = await db.getTask(taskId);
    if (!task) return line.reply(event.replyToken, msg.text('這個提醒已經不存在了。'));
    await db.removeTask(taskId);
    return line.reply(event.replyToken, msg.text(`已刪除提醒：${task.name} 🗑️`));
  }

  // 取消打卡（AI 確認卡按下「確認取消」）
  if (action === 'dellog') {
    const task = await db.getTask(taskId);
    const ok = await db.deleteLog(taskId, slot);
    return line.reply(
      event.replyToken,
      msg.text(ok ? `已取消 ${task ? task.name + ' ' : ''}${slot} 的打卡，稍後會再提醒。` : '這筆打卡已經不在了。')
    );
  }

  // 把剛收到的照片歸到某本圖鑑（快速回覆按下）
  if (action === 'file') {
    const entryId = Number(data.get('e'));
    const key = data.get('c');
    const col = collections.getCollection(key);
    if (!col) return line.reply(event.replyToken, msg.text('好，先放生命之書就好 🐾'));
    const entry = await db.setLifebookCollection(entryId, key);
    if (!entry) return line.reply(event.replyToken, msg.text('這張照片找不到了 🐾'));
    const n = await db.collectionProgress(entry.pet_id, key);
    const pet = await db.getPet(entry.pet_id);
    return line.reply(event.replyToken, msg.collectionFiled(col, n, careTone(pet).celebrate));
  }

  // 進入安寧期（確認後）
  if (action === 'hospice') {
    const petId = Number(data.get('t'));
    const pet = await db.getPet(petId);
    if (!pet) return line.reply(event.replyToken, msg.text('找不到這隻毛孩。'));
    await db.setCareState(petId, 'hospice');
    return line.reply(event.replyToken, msg.hospiceMessage(pet));
  }

  // 確認卡按「取消」
  if (action === 'noop') {
    return line.reply(event.replyToken, msg.text('好，這次不動作 🐾'));
  }

  // 開啟紀念模式（確認後）
  if (action === 'memorial') {
    const petId = Number(data.get('t'));
    const pet = await db.getPet(petId);
    if (!pet) return line.reply(event.replyToken, msg.text('找不到這隻毛孩。'));
    await db.archivePet(petId);
    const g = await db.getOrCreateGroup(gid);
    if (g.active_pet_id === petId) {
      const rest = await db.listPets(gid);
      await db.setActivePet(gid, rest[0]?.id || null);
    }
    const url = albumUrl(petId);
    return line.reply(event.replyToken, msg.memorialMessage(pet, url.startsWith('http') ? url : null));
  }
  return null;
}

async function handleImage(event) {
  const gid = sourceId(event);
  const pet = await db.resolvePet(gid, null);
  if (!pet) return line.reply(event.replyToken, msg.text('收到照片！先「新增寵物 名字」我才知道要收進誰的生命之書 🐾'));

  const by = await line.getDisplayName(event.source);
  let path = null;
  try {
    const buf = await line.getMessageContent(event.message.id);
    path = await db.uploadPhoto(gid, buf);
  } catch (e) {
    console.error('save photo failed', e);
  }
  const entry = await db.addLifebook(pet, { kind: 'memory', photo_path: path, by_name: by });
  if (!entry) return line.reply(event.replyToken, msg.text(`這一刻收進 ${pet.name} 的生命之書了 📖`));
  // 收好後，順手問要不要歸到某本圖鑑（快速回覆）
  return line.reply(event.replyToken, msg.photoSaved(pet, entry));
}
