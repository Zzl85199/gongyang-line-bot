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
import { careTone, ageYears } from './petstate.js';
import * as perms from './perms.js';

// 把年齡換成好讀的字串（給交接卡用）
function ageText(pet) {
  const y = ageYears(pet);
  if (y == null) return null;
  if (y < 1) return `${Math.round(y * 12)} 個月`;
  return `${Math.round(y * 10) / 10} 歲`;
}

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

  // 角色：開放模式（未啟用）時 member 留 null，perms.can 一律放行。
  const userId = event.source.userId;
  let member = null;
  if (group.roles_enabled && userId) {
    member = await db.getMember(gid, userId);
    if (!member || !member.display_name) {
      const nm = await line.getDisplayName(event.source);
      member = await db.upsertMember(gid, userId, nm);
    }
  }
  const canManage = () => perms.can(group, member, 'manage');
  const canCheckin = () => perms.can(group, member, 'checkin');

  if (/^(幫助|help|指令)$/i.test(t)) return line.reply(event.replyToken, msg.help(group.wake_word));
  if (/^(教學|怎麼用|新手|上手|教我)$/i.test(t)) return line.reply(event.replyToken, msg.teaching(group.wake_word));

  // ---- 角色權限（選用） ----
  let rm;
  if (/^(我是主飼主|我要當主飼主|啟用權限|開啟權限)$/.test(t)) {
    if (!userId) return line.reply(event.replyToken, msg.text('一對一聊天不需要分權限喔，請在群組裡設定。'));
    const owners = await db.countOwners(gid);
    const me = await db.getMember(gid, userId);
    if (owners > 0 && me?.role !== 'owner') {
      return line.reply(event.replyToken, msg.text('這個照護圈已經有主飼主了。請現有主飼主用「設定 你的名字 為 主飼主」新增。'));
    }
    const name = await line.getDisplayName(event.source);
    await db.upsertMember(gid, userId, name);
    await db.setMemberRole(gid, userId, 'owner');
    await db.setRolesEnabled(gid, true);
    return line.reply(event.replyToken, msg.rolesEnabled(name));
  }
  if (/^(停用權限|關閉權限)$/.test(t)) {
    if (!canManage()) return line.reply(event.replyToken, msg.noPermManage());
    await db.setRolesEnabled(gid, false);
    return line.reply(event.replyToken, msg.text('好，已停用角色權限，現在大家都能操作了 🐾'));
  }
  if (/^(成員|權限清單|誰是誰)$/.test(t)) {
    const members = await db.listMembers(gid);
    return line.reply(event.replyToken, msg.membersList(group, members));
  }
  if ((rm = t.match(/^設定\s+(.+?)\s+為\s+(.+)$/))) {
    if (!canManage()) return line.reply(event.replyToken, msg.noPermManage());
    const role = perms.parseRole(rm[2]);
    if (!role) return line.reply(event.replyToken, msg.text('角色請用：主飼主 / 照顧者 / 唯讀。'));
    const target = await db.findMemberByName(gid, rm[1]);
    if (!target) return line.reply(event.replyToken, msg.text(`還沒記到「${rm[1].trim()}」。請對方先在群裡說句話或按一次打卡，我記得他之後就能指派。`));
    await db.setMemberRole(gid, target.user_id, role);
    return line.reply(event.replyToken, msg.text(`好，${target.display_name || '對方'} 現在是「${perms.ROLE_LABEL[role]}」。`));
  }

  // ---- 寵物 ----
  let m;
  if ((m = t.match(/^(?:新增寵物|綁定)\s*(.+)$/))) {
    if (!canManage()) return line.reply(event.replyToken, msg.noPermManage());
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
    if (!canManage()) return line.reply(event.replyToken, msg.noPermManage());
    const pet = await db.findPetByName(gid, m[1].trim());
    if (!pet) return line.reply(event.replyToken, msg.text(`找不到「${m[1].trim()}」，先「新增寵物」吧。`));
    await db.setActivePet(gid, pet.id);
    return line.reply(event.replyToken, msg.text(`好，之後沒特別指定就是 ${pet.name} 🐾`));
  }

  // ---- 新增提醒（餵藥 / 餵食 / 散步 / 自訂） ----
  // 格式：新增用藥 [寵物] 名稱 時間  /  新增散步 [寵物] [名稱] 時間
  const kindMap = { 用藥: 'med', 餵藥: 'med', 餵食: 'feed', 吃飯: 'feed', 散步: 'walk', 提醒: 'custom' };
  if ((m = t.match(/^新增(用藥|餵藥|餵食|吃飯|散步|提醒)\s+(.+)$/))) {
    if (!canManage()) return line.reply(event.replyToken, msg.noPermManage());
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
      else tasks.forEach((tk) => lines.push(`　・${tk.name}${tk.dosage ? `（劑量：${tk.dosage}）` : ''}${tk.stock_count != null ? `（剩 ${tk.stock_count} 份）` : ''}（${tk.times.join('、')}）`));
    }
    return line.reply(event.replyToken, msg.text(lines.join('\n')));
  }

  if ((m = t.match(/^刪除提醒\s+(.+)$/))) {
    if (!canManage()) return line.reply(event.replyToken, msg.noPermManage());
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
    if (!canManage()) return line.reply(event.replyToken, msg.noPermManage());
    const names = m[1].split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!names.length) return line.reply(event.replyToken, msg.text('請給名單，例如「輪值 爸 媽 我」。'));
    await db.setDutyRotation(gid, names);
    return line.reply(event.replyToken, msg.text(`好，輪值順序：${names.join(' → ')}，從今天起每天輪一位 🙋`));
  }

  // ---- 過時補提醒（文字版） 過時提醒 30 / 關閉過時提醒 ----
  if ((m = t.match(/^過時提醒\s*(\d+)$/))) {
    if (!canManage()) return line.reply(event.replyToken, msg.noPermManage());
    const mins = parseInt(m[1], 10);
    await db.setOverdueMinutes(gid, mins);
    return line.reply(event.replyToken, msg.text(`好，超過 ${mins} 分鐘沒打卡我會補提醒一次。`));
  }
  if (/^關閉過時提醒$/.test(t)) {
    if (!canManage()) return line.reply(event.replyToken, msg.noPermManage());
    await db.setOverdueMinutes(gid, 0);
    return line.reply(event.replyToken, msg.text('好，已關閉過時補提醒。'));
  }

  // ---- 取消誤觸打卡（需求 8，文字版） 取消 早餐 07:00 ----
  if ((m = t.match(/^取消\s+(\S+)\s+(\d{1,2}[:：]\d{2})$/))) {
    if (!canCheckin()) return line.reply(event.replyToken, msg.noPermCheckin());
    const pet = await db.resolvePet(gid, null);
    if (!pet) return line.reply(event.replyToken, msg.text('請先「切換」到某隻毛孩。'));
    const task = await db.findTaskByName(pet.id, m[1]);
    if (!task) return line.reply(event.replyToken, msg.text(`找不到「${m[1]}」這個提醒。`));
    const slot = parseTimes(m[2])[0];
    const ok = await db.deleteLog(task.id, slot);
    if (ok && task.kind === 'med' && task.stock_count != null) await db.restoreStock(task);
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
    if (!canManage()) return line.reply(event.replyToken, msg.noPermManage());
    const pet = await db.findPetByNameAny(gid, m[1].trim());
    if (!pet) return line.reply(event.replyToken, msg.text(`找不到「${m[1].trim()}」。`));
    return line.reply(
      event.replyToken,
      msg.confirmCard(`要為 ${pet.name} 開啟紀念模式嗎？之後不會再傳牠的提醒，但回憶都會保留。`, '開啟紀念模式', `a=memorial&t=${pet.id}`)
    );
  }

  // ---- 圖鑑（改版：無分母系列 + 重要時刻 + 自訂） 圖鑑 [名字] ----
  if ((m = t.match(/^(?:圖鑑|收集冊|收藏冊)\s*(.*)$/))) {
    const nm = m[1].trim();
    const pet = nm ? await db.findPetByNameAny(gid, nm) : await db.resolvePet(gid, null);
    if (!pet) return line.reply(event.replyToken, msg.text('請「圖鑑 名字」，或先切換到某隻毛孩。'));
    const items = await db.listAllCollections(pet.id);
    return line.reply(event.replyToken, msg.collectionsList(pet, items));
  }

  // ---- 自己開一本圖鑑 新增圖鑑 復健紀錄 ----
  if ((m = t.match(/^新增圖鑑\s+(.+)$/))) {
    if (!canCheckin()) return line.reply(event.replyToken, msg.noPermCheckin());
    const pet = await db.resolvePet(gid, null);
    if (!pet) return line.reply(event.replyToken, msg.text('先「新增寵物」或「切換 名字」，再開圖鑑吧 🐾'));
    const col = await db.addCustomCollection(pet, m[1].trim().slice(0, 20));
    return line.reply(event.replyToken, msg.text(`已開新圖鑑「${col.emoji} ${col.title}」📚\n之後傳照片用「更多分類」，或「改圖鑑」就能收進這本。`));
  }

  // ---- 重新分類最近一張照片 改圖鑑 / 重新分類 ----
  if (/^(改圖鑑|重新分類|改分類)$/.test(t)) {
    if (!canCheckin()) return line.reply(event.replyToken, msg.noPermCheckin());
    const pet = await db.resolvePet(gid, null);
    if (!pet) return line.reply(event.replyToken, msg.text('先切換到某隻毛孩。'));
    const entry = await db.latestLifebookEntry(pet.id);
    if (!entry) return line.reply(event.replyToken, msg.text('還沒有照片可以分類，先傳張照片進來吧 🐾'));
    const cols = await db.listAllCollections(pet.id);
    return line.reply(event.replyToken, msg.collectionPicker(entry.id, cols, { unfile: true, prompt: `要把 ${pet.name} 最近這張照片收進哪本圖鑑？` }));
  }

  // ---- 用藥庫存（選填，不強制） 庫存 [寵物] 藥名 數量 ----
  if ((m = t.match(/^庫存\s+(.+)$/))) {
    if (!canManage()) return line.reply(event.replyToken, msg.noPermManage());
    const toks = m[1].trim().split(/\s+/);
    const count = parseInt(toks[toks.length - 1], 10);
    if (Number.isNaN(count)) return line.reply(event.replyToken, msg.text('請給數量，例如「庫存 腎臟藥 30」。'));
    let rest = toks.slice(0, -1);
    let pet = await db.findPetByName(gid, rest[0]);
    if (pet) rest = rest.slice(1); else pet = await db.resolvePet(gid, null);
    if (!pet) return line.reply(event.replyToken, msg.text('不確定是哪隻毛孩，請「庫存 名字 藥名 數量」。'));
    const task = await db.findTaskByName(pet.id, rest.join(' '));
    if (!task) return line.reply(event.replyToken, msg.text(`找不到「${rest.join(' ')}」這個提醒，請先新增用藥。`));
    await db.setTaskStock(task.id, { count });
    return line.reply(event.replyToken, msg.text(`好，${pet.name} 的「${task.name}」庫存設為 ${count} 份。\n每次打卡自動扣 1，剩 ${task.stock_threshold ?? 5} 份以下我會提醒補貨 🛒`));
  }

  // ---- 安寧期（重大轉換，先溫柔確認） 安寧 哈吉 ----
  if ((m = t.match(/^安寧\s+(.+)$/))) {
    if (!canManage()) return line.reply(event.replyToken, msg.noPermManage());
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
    if (!canManage()) return line.reply(event.replyToken, msg.noPermManage());
    const pet = await db.findPetByNameAny(gid, m[1].trim());
    if (!pet) return line.reply(event.replyToken, msg.text(`找不到「${m[1].trim()}」。`));
    await db.setCareState(pet.id, null);
    return line.reply(event.replyToken, msg.restoreMessage(pet));
  }

  // ---- 健康紀錄（Phase 3） ----
  // 體重 哈吉 5.2 / 體重 5.2（單隻時可省略名字） / 哈吉 體重 5.2（名字放前面也可以）
  if (
    (m = t.match(/^體重\s+(?:(\S+)\s+)?(\d+(?:\.\d+)?)\s*(?:kg|公斤|KG|Kg)?$/)) ||
    (m = t.match(/^(\S+)\s+體重\s+(\d+(?:\.\d+)?)\s*(?:kg|公斤|KG|Kg)?$/))
  ) {
    if (!canCheckin()) return line.reply(event.replyToken, msg.noPermCheckin());
    const pet = m[1] ? await db.findPetByName(gid, m[1]) : await db.resolvePet(gid, null);
    if (!pet) return line.reply(event.replyToken, msg.text('不確定是哪隻毛孩，請「體重 名字 5.2」。'));
    const num = parseFloat(m[2]);
    const prev = (await db.weightLogs(pet.id, 1))[0]?.value_num ?? null;
    const by = member?.display_name || (await line.getDisplayName(event.source));
    await db.addHealthLog(pet, { kind: 'weight', valueNum: num, byName: by });
    return line.reply(event.replyToken, msg.healthLogged(pet, 'weight', { num, prevNum: prev }));
  }
  // 食慾／症狀不帶文字 → 先跳出常見選項讓使用者點，不必自己想怎麼打成一句話
  if ((m = t.match(/^(食慾|症狀)$/))) {
    if (!canCheckin()) return line.reply(event.replyToken, msg.noPermCheckin());
    const pet = await db.resolvePet(gid, null);
    if (!pet) return line.reply(event.replyToken, msg.text(`不確定是哪隻毛孩，請先「切換 名字」，或直接打「${m[1]} 名字 內容」。`));
    return line.reply(event.replyToken, msg.healthPresetPicker(pet, m[1] === '食慾' ? 'appetite' : 'symptom'));
  }
  if ((m = t.match(/^(食慾|症狀|健康備註)\s+(.+)$/))) {
    if (!canCheckin()) return line.reply(event.replyToken, msg.noPermCheckin());
    const kind = m[1] === '食慾' ? 'appetite' : m[1] === '症狀' ? 'symptom' : 'note';
    const { pet, rest } = await petAndText(gid, m[2]);
    if (!pet) return line.reply(event.replyToken, msg.text(`不確定是哪隻毛孩，請「${m[1]} 名字 內容」。`));
    const by = member?.display_name || (await line.getDisplayName(event.source));
    await db.addHealthLog(pet, { kind, valueText: rest, byName: by });
    return line.reply(event.replyToken, msg.healthLogged(pet, kind, { valueText: rest }));
  }
  if ((m = t.match(/^(?:健康紀錄|病歷|健康)\s*(.*)$/))) {
    const nm = m[1].trim();
    const pet = nm ? await db.findPetByNameAny(gid, nm) : await db.resolvePet(gid, null);
    if (!pet) return line.reply(event.replyToken, msg.text('請「健康紀錄 名字」，或先切換到某隻毛孩。'));
    const logs = await db.recentHealthLogs(pet.id, 12);
    const weights = await db.weightLogs(pet.id, 8);
    return line.reply(event.replyToken, msg.healthTimeline(pet, logs, weights));
  }

  // ---- 散步日誌（地點/心情）----
  // 一鍵：打「遛狗 / 散步 / 走走」就記一筆，再點心情即可（最低門檻）
  if (/^(?:遛|遛狗|散步|散步打卡|走走)$/.test(t)) {
    if (!canCheckin()) return line.reply(event.replyToken, msg.noPermCheckin());
    const pet = await db.resolvePet(gid, null);
    if (!pet) return line.reply(event.replyToken, msg.text('先「切換 名字」或「遛 名字」，我才知道是哪隻毛孩 🐾'));
    const by = member?.display_name || (await line.getDisplayName(event.source));
    const walk = await db.addWalkLog(pet, { byName: by });
    const wk = await weekWalkCount(pet.id);
    return line.reply(event.replyToken, msg.walkQuick(pet, walk, wk));
  }
  // 打字版：遛 哈吉 河堤 開心 / 遛狗 河堤
  if ((m = t.match(/^(?:遛狗?|散步打卡|走走)\s+(.+)$/))) {
    if (!canCheckin()) return line.reply(event.replyToken, msg.noPermCheckin());
    const { pet, rest } = await petAndText(gid, m[1]);
    if (!pet) return line.reply(event.replyToken, msg.text('不確定是哪隻毛孩，請「遛 名字 地點 心情」。'));
    const toks = rest.split(/\s+/);
    const place = toks[0] || null;
    const mood = toks.slice(1).join(' ') || null;
    const by = member?.display_name || (await line.getDisplayName(event.source));
    const walk = await db.addWalkLog(pet, { place, mood, byName: by });
    const wk = await weekWalkCount(pet.id);
    return line.reply(event.replyToken, msg.walkLogged(pet, walk, wk));
  }
  if ((m = t.match(/^(?:散步紀錄|散步日誌|遛狗紀錄)\s*(.*)$/))) {
    const nm = m[1].trim();
    const pet = nm ? await db.findPetByNameAny(gid, nm) : await db.resolvePet(gid, null);
    if (!pet) return line.reply(event.replyToken, msg.text('請「散步紀錄 名字」，或先切換到某隻毛孩。'));
    const walks = await db.listWalkLogs(pet.id, 8);
    return line.reply(event.replyToken, msg.walkList(pet, walks));
  }

  // ---- 一鍵交接卡（給保母/獸醫） ----
  if ((m = t.match(/^(?:交接卡?|交班|handover)\s*(.*)$/i))) {
    const nm = m[1].trim();
    const pet = nm ? await db.findPetByNameAny(gid, nm) : await db.resolvePet(gid, null);
    if (!pet) return line.reply(event.replyToken, msg.text('請「交接卡 名字」，或先切換到某隻毛孩。'));
    return line.reply(event.replyToken, await buildHandover(gid, pet));
  }

  // ---- AI 自然語言（需求 5：聊天室觸發） ----
  const aiText = aiTrigger(t, mention, group.wake_word);
  if (aiText !== null) {
    const out = await ai.handleAI(gid, aiText, { canManage: canManage(), canCheckin: canCheckin() });
    return line.reply(event.replyToken, out);
  }

  // 其他訊息不回應，避免在群組製造噪音
  return null;
}

// 近 7 天的散步次數（給「本週第幾次」的成就感回饋）
async function weekWalkCount(petId) {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const until = new Date(Date.now() + 60000).toISOString();
  return db.countWalksBetween(petId, since, until);
}

// 解析「[寵物] 自由文字」：第一個 token 若是寵物名就取出，其餘當內容；否則用預設對象、整串當內容
async function petAndText(gid, raw) {
  const toks = raw.trim().split(/\s+/);
  let pet = await db.findPetByName(gid, toks[0]);
  let rest;
  if (pet) rest = toks.slice(1).join(' ').trim() || raw.trim();
  else {
    pet = await db.resolvePet(gid, null);
    rest = raw.trim();
  }
  return { pet, rest };
}

// 組一張交接卡：基本資料 + 每日提醒 + 今天進度 + 最近體重/狀況
async function buildHandover(gid, pet) {
  const tasks = await db.listTasks(pet.id);
  const logs = await db.todayLogs(gid);
  const doneSet = new Set(logs.filter((l) => l.pet_id === pet.id).map((l) => `${l.task_id}@${l.scheduled_time}`));
  const todayLines = [];
  for (const tk of tasks)
    for (const slot of tk.times)
      todayLines.push(`${doneSet.has(`${tk.id}@${slot}`) ? '✅' : '⬜'} ${slot} ${tk.name}`);
  const latestWeight = (await db.weightLogs(pet.id, 1))[0] || null;
  const health = await db.recentHealthLogs(pet.id, 20);
  const recentHealth = health.filter((h) => h.kind === 'symptom' || h.kind === 'note').slice(0, 3);
  return msg.handoverCard(pet, { ageText: ageText(pet), tasks, todayLines, latestWeight, recentHealth });
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
  const group = await db.getOrCreateGroup(gid);
  const data = new URLSearchParams(event.postback.data);
  const action = data.get('a');
  const taskId = Number(data.get('t'));
  const slot = data.get('s');

  // 角色把關（開放模式一律放行）
  const userId = event.source.userId;
  let member = group.roles_enabled && userId ? await db.getMember(gid, userId) : null;
  const MANAGE = new Set(['delrem', 'dellog', 'memorial', 'hospice']);
  const CHECKIN = new Set(['done', 'undo', 'file', 'morefile', 'unfile', 'walkmood', 'walkdel', 'walkphoto', 'healthpick']);
  if (MANAGE.has(action) && !perms.can(group, member, 'manage'))
    return line.reply(event.replyToken, msg.noPermManage());
  if (CHECKIN.has(action) && !perms.can(group, member, 'checkin'))
    return line.reply(event.replyToken, msg.noPermCheckin());

  if (action === 'done') {
    const task = await db.getTask(taskId);
    if (!task) return line.reply(event.replyToken, msg.text('這個提醒已經不存在了。'));
    const name = await line.getDisplayName(event.source);
    await db.upsertMember(gid, userId, name); // 順手記住這位成員（方便日後設角色）
    const { created, log } = await db.markDone(task, slot, event.source.userId, name);
    if (!created) {
      const tz = await db.getGroupTimezone(task.group_id); // 用照護圈實際時區顯示，而不是硬寫台北
      return line.reply(event.replyToken, msg.alreadyDone(log, task, slot, tz));
    }
    const out = [msg.doneConfirm(name, task, slot)];
    // 散步提醒打卡也算一次散步，同步寫進 walk_logs，「達成率」跟「散步次數」統計才會一致
    if (task.kind === 'walk') {
      const pet = await db.getPet(task.pet_id);
      if (pet) await db.addWalkLog(pet, { byName: name, walkedAt: log?.done_at || undefined, taskId: task.id, scheduledTime: slot });
    }
    // 用藥且有設庫存 → 扣 1，低於門檻/用完才提醒補貨
    if (task.kind === 'med' && task.stock_count != null) {
      const stock = await db.consumeStock(task);
      if (stock && (stock.crossed || stock.empty)) {
        const pet = await db.getPet(task.pet_id);
        out.push(msg.restockMessage(pet, task, stock));
      }
    }
    return line.reply(event.replyToken, out);
  }

  if (action === 'undo') {
    const task = await db.getTask(taskId);
    if (!task) return line.reply(event.replyToken, msg.text('這個提醒已經不存在了。'));
    const ok = await db.deleteLog(taskId, slot);
    if (ok && task.kind === 'med' && task.stock_count != null) await db.restoreStock(task);
    if (ok && task.kind === 'walk') await db.deleteWalkLogByTask(taskId, slot);
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
    if (ok && task && task.kind === 'med' && task.stock_count != null) await db.restoreStock(task);
    return line.reply(
      event.replyToken,
      msg.text(ok ? `已取消 ${task ? task.name + ' ' : ''}${slot} 的打卡，稍後會再提醒。` : '這筆打卡已經不在了。')
    );
  }

  // 把剛收到的照片歸到某本圖鑑（快速回覆按下）
  if (action === 'file') {
    const entryId = Number(data.get('e'));
    const key = data.get('c');
    const entry = await db.setLifebookCollection(entryId, key);
    if (!entry) return line.reply(event.replyToken, msg.text('這張照片找不到了 🐾'));
    const col = await db.getCollectionMeta(entry.pet_id, key);
    if (!col) return line.reply(event.replyToken, msg.text('好，先放生命之書就好 🐾'));
    const n = await db.collectionProgress(entry.pet_id, key);
    const pet = await db.getPet(entry.pet_id);
    const celebrate = careTone(pet).celebrate;
    const isMs = col.kind === 'series' && collections.isMilestoneCount(n);
    const out = [msg.collectionFiled(entryId, col, n, { celebrate, isMilestone: isMs })];
    // 系列到柔性里程碑 → 自動拼一張回顧卡（安寧/紀念不推）
    if (isMs && celebrate !== 'off') {
      const entries = (await db.lifebookByCollection(entry.pet_id, key, 9)).filter((e) => e.photo_path);
      if (entries.length) {
        const urls = await Promise.all(entries.map((e) => db.signedPhotoUrl(e.photo_path)));
        out.push(...msg.collectionRecap(pet, col, entries, urls));
      }
    }
    return line.reply(event.replyToken, out);
  }

  // 更多分類 / 改放別本：列出全部圖鑑讓使用者重選
  if (action === 'morefile') {
    const entryId = Number(data.get('e'));
    const entry = await db.getLifebookEntry(entryId);
    if (!entry) return line.reply(event.replyToken, msg.text('這張照片找不到了 🐾'));
    const cols = await db.listAllCollections(entry.pet_id);
    return line.reply(event.replyToken, msg.collectionPicker(entryId, cols, { unfile: true, prompt: '要收進哪本圖鑑？（可改放或移出）' }));
  }

  // 移出圖鑑（照片仍留在生命之書）
  if (action === 'unfile') {
    const entryId = Number(data.get('e'));
    await db.setLifebookCollection(entryId, null);
    return line.reply(event.replyToken, msg.text('已移出圖鑑，照片還在生命之書 🐾'));
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

  // 散步：一鍵選心情 / 取消 / 把照片同時記成散步
  if (action === 'walkmood') {
    const wid = Number(data.get('w'));
    const mood = data.get('m') ? decodeURIComponent(data.get('m')) : null;
    const w = await db.getWalkLog(wid);
    if (!w) return line.reply(event.replyToken, msg.text('這筆散步紀錄已經不在了。'));
    await db.updateWalkLog(wid, { mood });
    return line.reply(event.replyToken, msg.text(`好，心情記成「${mood}」了 🦮`));
  }
  if (action === 'walkdel') {
    const wid = Number(data.get('w'));
    await db.deleteWalkLog(wid);
    return line.reply(event.replyToken, msg.text('已取消這筆散步紀錄 🐾'));
  }
  if (action === 'walkphoto') {
    const entryId = Number(data.get('e'));
    const petId = Number(data.get('p'));
    const pet = await db.getPet(petId);
    if (!pet) return line.reply(event.replyToken, msg.text('找不到這隻毛孩。'));
    await db.setLifebookCollection(entryId, 'walk'); // 照片收進「散步紀錄」圖鑑
    const name = await line.getDisplayName(event.source);
    const walk = await db.addWalkLog(pet, { byName: name });
    const wk = await weekWalkCount(pet.id);
    return line.reply(event.replyToken, msg.walkQuick(pet, walk, wk));
  }

  // Rich Menu「健康」按鈕：先選要記哪一種，不用背體重/食慾/症狀/備註四個指令詞
  if (action === 'healthmenu') {
    return line.reply(event.replyToken, msg.healthMenu());
  }
  if (action === 'healthkind') {
    const kind = data.get('k');
    if (kind === 'view') {
      const pet = await db.resolvePet(gid, null);
      if (!pet) return line.reply(event.replyToken, msg.text('請先「切換 名字」，或打「健康紀錄 名字」查看。'));
      const logs = await db.recentHealthLogs(pet.id, 12);
      const weights = await db.weightLogs(pet.id, 8);
      return line.reply(event.replyToken, msg.healthTimeline(pet, logs, weights));
    }
    const pet = await db.resolvePet(gid, null);
    if (!pet) return line.reply(event.replyToken, msg.text('不確定是哪隻毛孩，請先「切換 名字」。'));
    if (kind === 'weight') return line.reply(event.replyToken, msg.text(`好，請打「體重 ${pet.name} 5.2」這樣的格式（單隻時可省略名字，直接打「體重 5.2」）。`));
    if (kind === 'note') return line.reply(event.replyToken, msg.text(`好，請打「健康備註 ${pet.name} 內容」，例如「健康備註 ${pet.name} 剛洗完澡」。`));
    if (kind === 'appetite' || kind === 'symptom') return line.reply(event.replyToken, msg.healthPresetPicker(pet, kind));
    return null;
  }
  // 食慾／症狀常見選項：點一下直接記錄
  if (action === 'healthpick') {
    const petId = Number(data.get('p'));
    const kind = data.get('k');
    const value = data.get('v') ? decodeURIComponent(data.get('v')) : '';
    const pet = await db.getPet(petId);
    if (!pet) return line.reply(event.replyToken, msg.text('找不到這隻毛孩。'));
    const by = member?.display_name || (await line.getDisplayName(event.source));
    await db.addHealthLog(pet, { kind, valueText: value, byName: by });
    return line.reply(event.replyToken, msg.healthLogged(pet, kind, { valueText: value }));
  }
  // 食慾／症狀選「其他」：引導使用者自己打字
  if (action === 'healthother') {
    const kind = data.get('k');
    const petId = Number(data.get('p'));
    const pet = petId ? await db.getPet(petId) : await db.resolvePet(gid, null);
    if (!pet) return line.reply(event.replyToken, msg.text('不確定是哪隻毛孩，請先「切換 名字」。'));
    return line.reply(event.replyToken, msg.healthOtherPrompt(pet, kind));
  }

  // 小任務：換一個 / 簡單一點 / 想動一動（抽到做不到的可直接換掉）
  if (action === 'task') {
    const petId = Number(data.get('p'));
    const lv = data.get('lv') || null;
    const last = data.get('last') ? decodeURIComponent(data.get('last')) : null;
    const pet = petId ? await db.getPet(petId) : await db.resolvePet(gid, null);
    if (!pet) return line.reply(event.replyToken, msg.text('先「新增寵物」或「切換 名字」，再來個小任務吧 🐾'));
    return line.reply(event.replyToken, msg.activitySuggestion(pet, suggestActivity(pet, { lastTitle: last, level: lv })));
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

  // Rich Menu「更多」按鈕：直接顯示完整指令說明
  if (action === 'help') {
    return line.reply(event.replyToken, msg.help(group.wake_word));
  }
  return null;
}

async function handleImage(event) {
  const gid = sourceId(event);
  const pet = await db.resolvePet(gid, null);
  if (!pet) return line.reply(event.replyToken, msg.text('收到照片！先「新增寵物 名字」我才知道要收進誰的生命之書 🐾'));

  const by = await line.getDisplayName(event.source);
  await db.upsertMember(gid, event.source.userId, by);
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
