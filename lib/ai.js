// lib/ai.js
// AI 路由器：用 function calling 把使用者的一句話變成動作。
// 供應商切換：AI_PROVIDER=gemini / anthropic（留空則哪個金鑰有填用哪個，兩個都有先 Gemini）。
// 回傳：一律是「LINE 訊息陣列」(handlers 直接拿去回覆)，這樣才能回照片輪播、確認卡等富訊息。
import * as db from './db.js';
import * as msg from './messages.js';
import { parseTimes, taipeiTimeToISO, hhmmTaipei, dateKeyTaipei } from './time.js';
import { suggestActivity } from './activities.js';
import { albumUrl } from './album.js';
import { ageYears } from './petstate.js';

const ageText = (pet) => {
  const y = ageYears(pet);
  if (y == null) return null;
  return y < 1 ? `${Math.round(y * 12)} 個月` : `${Math.round(y * 10) / 10} 歲`;
};

// 工具的權限層級（角色啟用時用；開放模式一律放行）
const MANAGE_TOOLS = new Set([
  'add_pet', 'switch_pet', 'add_reminder', 'edit_reminder', 'remove_reminder',
  'set_duty', 'set_overdue', 'set_pet_info', 'set_stock', 'memorialize', 'enter_hospice', 'restore_care',
]);
const CHECKIN_TOOLS = new Set(['snooze_reminder', 'delete_checkin', 'log_health', 'new_collection']);

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

// 快速模式：執行完工具後直接回結果，省掉第二趟模型呼叫，延遲約砍半。
// 想要更口語的回覆可設 AI_FAST_REPLY=0。注意：刪除確認卡、生命之書照片一律即時回（不經第二趟）。
const FAST = (process.env.AI_FAST_REPLY ?? '1') !== '0';

function provider() {
  const p = (process.env.AI_PROVIDER || '').toLowerCase();
  if (p === 'gemini') return GEMINI_KEY ? 'gemini' : null;
  if (p === 'anthropic') return ANTHROPIC_KEY ? 'anthropic' : null;
  if (GEMINI_KEY) return 'gemini';
  if (ANTHROPIC_KEY) return 'anthropic';
  return null;
}
export const aiEnabled = () => provider() !== null;

// ---------- 工具定義（與供應商無關） ----------
const TOOLS = [
  { name: 'add_pet', description: '新增一隻寵物',
    input_schema: { type: 'object', properties: {
      name: { type: 'string' }, species: { type: 'string', description: '狗/貓等，可省略' } }, required: ['name'] } },
  { name: 'list_pets', description: '列出目前有哪些寵物',
    input_schema: { type: 'object', properties: {} } },
  { name: 'switch_pet', description: '把預設對象切換成某隻寵物（之後沒指定名字就用這隻）',
    input_schema: { type: 'object', properties: { pet_name: { type: 'string' } }, required: ['pet_name'] } },
  { name: 'add_reminder',
    description: '新增定時提醒。kind: med(餵藥)/feed(餵食)/walk(散步)/custom(其他)。times 是 24h 制 HH:MM 陣列。',
    input_schema: { type: 'object', properties: {
      pet_name: { type: 'string', description: '只有一隻時可省略' },
      kind: { type: 'string', enum: ['med', 'feed', 'walk', 'custom'] },
      name: { type: 'string' },
      times: { type: 'array', items: { type: 'string' } },
      dosage: { type: 'string', description: '劑量，例如「半顆」「0.5 顆」「1ml」。餵藥(med)時建議填，會顯示在提醒卡上' },
      emoji: { type: 'string' } }, required: ['kind', 'name', 'times'] } },
  { name: 'edit_reminder', description: '修改某個提醒的時間或劑量（給什麼就改什麼）',
    input_schema: { type: 'object', properties: {
      pet_name: { type: 'string' }, name: { type: 'string' },
      times: { type: 'array', items: { type: 'string' }, description: '新的 HH:MM 陣列（要改時間才給）' },
      dosage: { type: 'string', description: '新的劑量（要改劑量才給）' } }, required: ['name'] } },
  { name: 'snooze_reminder', description: '順延 / 晚點再提醒一次。給 minutes（幾分鐘後）或 time（今天某個 HH:MM）。',
    input_schema: { type: 'object', properties: {
      pet_name: { type: 'string' }, name: { type: 'string' },
      minutes: { type: 'integer', description: '幾分鐘後再提醒' },
      time: { type: 'string', description: '今天的 HH:MM 再提醒' } }, required: ['name'] } },
  { name: 'list_reminders', description: '列出提醒',
    input_schema: { type: 'object', properties: { pet_name: { type: 'string' } } } },
  { name: 'remove_reminder', description: '刪除某個提醒（會先請使用者按鈕確認，不會立刻刪）',
    input_schema: { type: 'object', properties: {
      pet_name: { type: 'string' }, name: { type: 'string' } }, required: ['name'] } },
  { name: 'today_status', description: '查今天每隻寵物每個提醒做了沒',
    input_schema: { type: 'object', properties: {} } },
  { name: 'delete_checkin', description: '取消今天某提醒某時段的打卡（會先請使用者按鈕確認，不會立刻刪）',
    input_schema: { type: 'object', properties: {
      pet_name: { type: 'string' }, name: { type: 'string' }, time: { type: 'string' } }, required: ['name', 'time'] } },
  { name: 'show_lifebook', description: '回顧生命之書，會把最近的照片做成輪播秀出來',
    input_schema: { type: 'object', properties: {
      pet_name: { type: 'string' }, limit: { type: 'integer', description: '幾張，預設 8' } } } },
  { name: 'set_duty', description: '設定家人輪值名單（每天輪一位），例如 ["爸","媽","我"]',
    input_schema: { type: 'object', properties: {
      names: { type: 'array', items: { type: 'string' } } }, required: ['names'] } },
  { name: 'set_overdue', description: '設定過時補提醒：超過 minutes 分鐘沒打卡就補提醒一次（0=關閉）',
    input_schema: { type: 'object', properties: { minutes: { type: 'integer' } }, required: ['minutes'] } },
  { name: 'set_pet_info', description: '設定某隻寵物的年齡(歲)或病況，用來自動調整活動建議',
    input_schema: { type: 'object', properties: {
      pet_name: { type: 'string' }, age_years: { type: 'number' }, health: { type: 'string', description: '病況，如「腎臟病、關節退化」' } } } },
  { name: 'log_health', description: '記錄健康狀況（會存進病歷時間軸）。可同時給多項：weight(公斤,數字)、appetite(食慾)、symptom(症狀)、note(備註)。',
    input_schema: { type: 'object', properties: {
      pet_name: { type: 'string' },
      weight: { type: 'number', description: '體重(公斤)' },
      appetite: { type: 'string', description: '食慾，如 正常/不佳/沒吃' },
      symptom: { type: 'string', description: '症狀描述' },
      note: { type: 'string', description: '其他備註' } } } },
  { name: 'show_health', description: '查看某隻寵物的健康紀錄/病歷時間軸（含體重變化）',
    input_schema: { type: 'object', properties: { pet_name: { type: 'string' } } } },
  { name: 'suggest_activity', description: '依寵物年齡與病況，建議一個合適的互動小任務',
    input_schema: { type: 'object', properties: { pet_name: { type: 'string' } } } },
  { name: 'show_collections', description: '查看某隻寵物的「圖鑑/收集冊」收集進度',
    input_schema: { type: 'object', properties: { pet_name: { type: 'string' } } } },
  { name: 'new_collection', description: '幫寵物開一本自訂圖鑑（收集系列），例如「復健紀錄」「跟妹妹的合照」',
    input_schema: { type: 'object', properties: { pet_name: { type: 'string' }, title: { type: 'string' } }, required: ['title'] } },
  { name: 'set_stock', description: '設定某個用藥的庫存量（顆/份）。之後每次打卡自動扣 1，低於門檻會提醒補貨。',
    input_schema: { type: 'object', properties: {
      pet_name: { type: 'string' }, name: { type: 'string', description: '藥名/提醒名稱' },
      count: { type: 'integer', description: '目前剩餘量' },
      threshold: { type: 'integer', description: '低於多少提醒補貨，可省略（預設5）' } }, required: ['name', 'count'] } },
  { name: 'enter_hospice', description: '把寵物切到「安寧期」：仍發藥物提醒，但停止自動任務與所有慶祝。重大且敏感，會先請使用者按鈕確認。',
    input_schema: { type: 'object', properties: { pet_name: { type: 'string' } }, required: ['pet_name'] } },
  { name: 'restore_care', description: '結束安寧期，讓寵物回到日常照護（自動依年齡/病況推導狀態）',
    input_schema: { type: 'object', properties: { pet_name: { type: 'string' } }, required: ['pet_name'] } },
  { name: 'make_album', description: '產生某隻寵物可保存的生命之書紀念冊連結（網頁會自動播放照片）',
    input_schema: { type: 'object', properties: { pet_name: { type: 'string' } } } },
  { name: 'memorialize', description: '為已離世的寵物開啟紀念模式（停止提醒、保留回憶）。重大操作，會先請使用者按鈕確認。',
    input_schema: { type: 'object', properties: { pet_name: { type: 'string' } }, required: ['pet_name'] } },
];

// ---------- 工具執行：回 { result(文字), display?(LINE 訊息陣列) } ----------
async function exec(groupId, toolName, input, perms = { canManage: true, canCheckin: true }) {
  const r = (result, display) => (display ? { result, display } : { result });
  // 角色把關（開放模式時 handlers 會傳 canManage/canCheckin 皆 true）
  if (MANAGE_TOOLS.has(toolName) && !perms.canManage)
    return r('這個操作要主飼主才能做喔。請主飼主處理，或你自己打「我是主飼主」。');
  if (CHECKIN_TOOLS.has(toolName) && !perms.canCheckin)
    return r('你目前是「唯讀」身分，沒辦法做這個。請主飼主把你設為照顧者，或打「我是照顧者」。');
  switch (toolName) {
    case 'add_pet': {
      const pet = await db.addPet(groupId, input.name, input.species || null);
      return r(`已新增寵物：${pet.name} 🐾`);
    }
    case 'list_pets': {
      const pets = await db.listPets(groupId);
      return r(pets.length ? '目前的毛孩：' + pets.map((p) => p.name).join('、') : '目前沒有任何寵物');
    }
    case 'switch_pet': {
      const pet = await db.findPetByName(groupId, input.pet_name);
      if (!pet) return r(`找不到「${input.pet_name}」`);
      await db.setActivePet(groupId, pet.id);
      return r(`好，之後預設是 ${pet.name} 🐾`);
    }
    case 'add_reminder': {
      const pet = await db.resolvePet(groupId, input.pet_name);
      if (!pet) return r('找不到對象寵物，請先告訴我是哪一隻（或先新增寵物）');
      const times = parseTimes((input.times || []).join(','));
      if (!times.length) return r('時間格式看不懂，請給像 08:00 這樣的時間');
      // 去重：同一隻寵物若已有同名提醒，就「更新時間/劑量」而不是再插一筆，避免重複任務 → 重複推播
      const existing = await db.findTaskByName(pet.id, input.name);
      if (existing) {
        await db.updateTaskFields(existing.id, { times, dosage: input.dosage });
        const dl = input.dosage ? `，劑量：${input.dosage}` : '';
        return r(`已更新 ${pet.name} 的「${existing.name}」時間：${times.join('、')}${dl}（原本的同名提醒已覆蓋，不會重複）`);
      }
      const t = await db.addTask(pet, { kind: input.kind, name: input.name, times, emoji: input.emoji, dosage: input.dosage });
      const dl = input.dosage ? `，劑量：${input.dosage}` : '';
      return r(`已為 ${pet.name} 新增提醒：${t.name}（${times.join('、')}）${dl}`);
    }
    case 'edit_reminder': {
      const pet = await db.resolvePet(groupId, input.pet_name);
      if (!pet) return r('找不到對象寵物');
      const t = await db.findTaskByName(pet.id, input.name);
      if (!t) return r(`找不到名為「${input.name}」的提醒`);
      const fields = {};
      if (input.times && input.times.length) {
        const times = parseTimes(input.times.join(','));
        if (!times.length) return r('時間格式看不懂');
        fields.times = times;
      }
      if (input.dosage !== undefined) fields.dosage = input.dosage;
      if (!Object.keys(fields).length) return r('沒有要改的內容，給我新的時間或劑量');
      await db.updateTaskFields(t.id, fields);
      const parts = [];
      if (fields.times) parts.push(`時間 ${fields.times.join('、')}`);
      if (fields.dosage !== undefined) parts.push(`劑量 ${fields.dosage || '（清除）'}`);
      return r(`已更新 ${pet.name} 的「${t.name}」：${parts.join('、')}`);
    }
    case 'snooze_reminder': {
      const pet = await db.resolvePet(groupId, input.pet_name);
      if (!pet) return r('找不到對象寵物');
      const t = await db.findTaskByName(pet.id, input.name);
      if (!t) return r(`找不到名為「${input.name}」的提醒`);
      let remindAt, slotLabel;
      if (input.time) {
        const slot = parseTimes(input.time)[0];
        if (!slot) return r('時間格式看不懂');
        remindAt = taipeiTimeToISO(slot);
        slotLabel = slot;
      } else {
        const mins = Math.max(1, parseInt(input.minutes || 30, 10));
        const d = new Date(Date.now() + mins * 60000);
        remindAt = d.toISOString();
        slotLabel = hhmmTaipei(d);
      }
      await db.addOneoff(pet, { label: t.name, emoji: t.emoji, remindAt, taskId: t.id, scheduledTime: slotLabel });
      return r(`好，${slotLabel} 會再提醒一次 ${pet.name} 的「${t.name}」⏰`);
    }
    case 'list_reminders': {
      const pet = await db.resolvePet(groupId, input.pet_name);
      const tasks = pet ? await db.listTasks(pet.id) : await db.listTasksByGroup(groupId);
      if (!tasks.length) return r('目前沒有任何提醒');
      return r(tasks.map((t) => `${t.name}（${t.times.join('、')}）`).join('；'));
    }
    case 'remove_reminder': {
      const pet = await db.resolvePet(groupId, input.pet_name);
      if (!pet) return r('找不到對象寵物');
      const t = await db.findTaskByName(pet.id, input.name);
      if (!t) return r(`找不到名為「${input.name}」的提醒`);
      return r('（等待確認刪除）', [
        msg.confirmCard(`要刪除 ${pet.name} 的「${t.name}」提醒嗎？`, '確認刪除', `a=delrem&t=${t.id}`),
      ]);
    }
    case 'today_status': {
      const logs = await db.todayLogs(groupId);
      const pets = await db.listPets(groupId);
      const lines = [];
      for (const pet of pets) {
        const tasks = await db.listTasks(pet.id);
        for (const t of tasks)
          for (const slot of t.times) {
            const done = logs.find((l) => l.task_id === t.id && l.scheduled_time === slot);
            lines.push(`${pet.name} ${slot} ${t.name}：${done ? '已完成' : '尚未'}`);
          }
      }
      return r(lines.length ? lines.join('\n') : '今天還沒有任何排定的提醒');
    }
    case 'delete_checkin': {
      const pet = await db.resolvePet(groupId, input.pet_name);
      if (!pet) return r('找不到對象寵物');
      const t = await db.findTaskByName(pet.id, input.name);
      if (!t) return r(`找不到名為「${input.name}」的提醒`);
      const slot = parseTimes(input.time)[0];
      if (!slot) return r('時間格式看不懂');
      return r('（等待確認取消打卡）', [
        msg.confirmCard(`要取消 ${pet.name} ${t.name} ${slot} 的打卡嗎？`, '確認取消', `a=dellog&t=${t.id}&s=${encodeURIComponent(slot)}`),
      ]);
    }
    case 'show_lifebook': {
      const pet = await db.resolvePet(groupId, input.pet_name);
      if (!pet) return r('找不到對象寵物');
      const limit = Math.min(10, Math.max(1, input.limit || 8));
      const entries = await db.recentLifebook(pet.id, limit);
      if (!entries.length) return r(`${pet.name} 的生命之書還是空的 📖，把照片傳進群組就是第一頁。`);
      const urls = await Promise.all(entries.map((e) => db.signedPhotoUrl(e.photo_path)));
      const count = await db.lifebookCount(pet.id);
      return r(`📖 ${pet.name} 的生命之書（${count} 個時光）`, [
        msg.text(`📖 ${pet.name} 的生命之書，已收藏 ${count} 個時光，最近這些：`),
        msg.lifebookCarousel(pet, entries, urls),
      ]);
    }
    case 'set_duty': {
      const names = (input.names || []).map((s) => String(s).trim()).filter(Boolean);
      if (!names.length) return r('請給輪值名單，例如「爸、媽、我」');
      await db.setDutyRotation(groupId, names);
      return r(`好，輪值順序：${names.join(' → ')}，從今天起每天輪一位 🙋`);
    }
    case 'set_overdue': {
      const m = Math.max(0, parseInt(input.minutes, 10) || 0);
      await db.setOverdueMinutes(groupId, m);
      return r(m ? `好，超過 ${m} 分鐘沒打卡，我會在群裡補提醒一次。` : '好，已關閉過時補提醒。');
    }
    case 'set_pet_info': {
      const pet = await db.resolvePet(groupId, input.pet_name);
      if (!pet) return r('找不到對象寵物');
      const fields = {};
      if (input.age_years != null) {
        const d = new Date(Date.now() - Number(input.age_years) * 365.25 * 86400000);
        fields.birthday = dateKeyTaipei(d);
      }
      if (input.health != null) fields.health = String(input.health);
      await db.setPetInfo(pet.id, fields);
      return r(`已更新 ${pet.name} 的資料 🐾（活動建議會跟著調整）`);
    }
    case 'suggest_activity': {
      const pet = await db.resolvePet(groupId, input.pet_name);
      if (!pet) return r('找不到對象寵物');
      const act = suggestActivity(pet);
      if (!act) return r(`現在先好好陪 ${pet.name} 就好 🤍`);
      return r(`${act.title}：${act.prompt}`, [msg.activitySuggestion(pet, act)]);
    }
    case 'log_health': {
      const pet = await db.resolvePet(groupId, input.pet_name);
      if (!pet) return r('找不到對象寵物');
      const done = [];
      if (input.weight != null) { await db.addHealthLog(pet, { kind: 'weight', valueNum: Number(input.weight) }); done.push(`體重 ${input.weight} kg`); }
      if (input.appetite) { await db.addHealthLog(pet, { kind: 'appetite', valueText: String(input.appetite) }); done.push(`食慾：${input.appetite}`); }
      if (input.symptom) { await db.addHealthLog(pet, { kind: 'symptom', valueText: String(input.symptom) }); done.push(`症狀：${input.symptom}`); }
      if (input.note) { await db.addHealthLog(pet, { kind: 'note', valueText: String(input.note) }); done.push(`備註：${input.note}`); }
      if (!done.length) return r('要記什麼呢？可以說體重、食慾、症狀或備註。');
      return r(`已記到 ${pet.name} 的病歷：${done.join('、')} 📋`);
    }
    case 'show_health': {
      const pet = await db.resolvePet(groupId, input.pet_name);
      if (!pet) return r('找不到對象寵物');
      const logs = await db.recentHealthLogs(pet.id, 12);
      const weights = await db.weightLogs(pet.id, 8);
      return r(`${pet.name} 的健康紀錄`, [msg.healthTimeline(pet, logs, weights)]);
    }
    case 'show_collections': {
      const pet = await db.resolvePet(groupId, input.pet_name);
      if (!pet) return r('找不到對象寵物');
      const items = await db.listAllCollections(pet.id);
      return r(`${pet.name} 的圖鑑`, [msg.collectionsList(pet, items)]);
    }
    case 'new_collection': {
      const pet = await db.resolvePet(groupId, input.pet_name);
      if (!pet) return r('找不到對象寵物');
      const col = await db.addCustomCollection(pet, String(input.title).slice(0, 20));
      return r(`已開新圖鑑「${col.emoji} ${col.title}」📚`);
    }
    case 'set_stock': {
      const pet = await db.resolvePet(groupId, input.pet_name);
      if (!pet) return r('找不到對象寵物');
      const task = await db.findTaskByName(pet.id, input.name);
      if (!task) return r(`找不到「${input.name}」這個提醒`);
      const fields = { count: Number(input.count) };
      if (input.threshold != null) fields.threshold = Number(input.threshold);
      await db.setTaskStock(task.id, fields);
      return r(`好，${pet.name} 的「${task.name}」庫存設為 ${input.count} 份，打卡會自動扣、快用完會提醒補貨 🛒`);
    }
    case 'enter_hospice': {
      const pet = await db.findPetByNameAny(groupId, input.pet_name);
      if (!pet) return r('找不到對象寵物');
      return r('（等待確認進入安寧期）', [
        msg.confirmCard(
          `要把 ${pet.name} 切到安寧期嗎？藥物提醒會照常，但不再丟活動任務、也不會有慶祝。`,
          '進入安寧期',
          `a=hospice&t=${pet.id}`
        ),
      ]);
    }
    case 'restore_care': {
      const pet = await db.findPetByNameAny(groupId, input.pet_name);
      if (!pet) return r('找不到對象寵物');
      await db.setCareState(pet.id, null);
      return r(`好，${pet.name} 回到日常照護的步調了 🐾`);
    }
    case 'make_album': {
      const pet = (await db.findPetByNameAny(groupId, input.pet_name)) || (await db.resolvePet(groupId, input.pet_name));
      if (!pet) return r('找不到對象寵物');
      const url = albumUrl(pet.id);
      if (!url.startsWith('http')) return r('紀念冊連結還缺網址設定，請在環境變數設 PUBLIC_BASE_URL。');
      return r(`📖 ${pet.name} 的紀念冊：\n${url}`);
    }
    case 'memorialize': {
      const pet = await db.findPetByNameAny(groupId, input.pet_name);
      if (!pet) return r('找不到對象寵物');
      return r('（等待確認開啟紀念模式）', [
        msg.confirmCard(
          `要為 ${pet.name} 開啟紀念模式嗎？之後不會再傳牠的提醒，但回憶都會保留。`,
          '開啟紀念模式',
          `a=memorial&t=${pet.id}`
        ),
      ]);
    }
    default:
      return r('未知的工具');
  }
}

function systemPrompt(pets) {
  return (
    '你是「共養日誌」的寵物照護小幫手，在 LINE 群組裡幫一家人管理毛孩的提醒與紀錄。' +
    '使用繁體中文、語氣親切簡短。需要動作時務必呼叫工具，不要只用講的。時間一律換算成 24 小時制 HH:MM。' +
    '當你提出一個方案（例如一組餵食時間）並徵詢同意後，使用者只要回覆「好」「可以」「沒問題」等同意語，' +
    '你就要「立刻呼叫對應工具」把設定真正寫進去，而不是再用文字說「我會幫你設定」。' +
    `目前這個照護圈的寵物：${pets.length ? pets.map((p) => p.name).join('、') : '（還沒有）'}。`
  );
}

// 把多個工具輸出組成 LINE 訊息陣列
function assemble(outs) {
  const displays = outs.filter((o) => o.display).flatMap((o) => o.display);
  if (displays.length) {
    const extra = outs.filter((o) => !o.display && o.result).map((o) => msg.text(o.result));
    return [...extra, ...displays];
  }
  const text = outs.map((o) => o.result).filter(Boolean).join('\n');
  return [msg.text(text || '好的 🐾')];
}

// 把 DB 歷史整理成「嚴格交替、且以 user 開頭」的對話（Anthropic 要求交替；Gemini 也吃這個）。
function sanitizeHistory(history) {
  const out = [];
  for (const h of history || []) {
    const role = h.role === 'assistant' ? 'assistant' : 'user';
    if (!h.content) continue;
    if (out.length === 0 && role !== 'user') continue; // 必須 user 開頭
    if (out.length && out[out.length - 1].role === role) {
      out[out.length - 1].content += '\n' + h.content; // 合併同角色，避免連續同 role
      continue;
    }
    out.push({ role, content: h.content });
  }
  // 後面會再接「這次的 user 訊息」，所以歷史若以 user 結尾要去掉，免得 user,user 連續
  if (out.length && out[out.length - 1].role === 'user') out.pop();
  return out;
}

// 從要回給 LINE 的訊息陣列裡抽出可存進記憶的文字（純文字優先，否則用卡片的 altText）。
function summarizeReply(messages) {
  const txt = (messages || [])
    .filter((m) => m && m.type === 'text' && m.text)
    .map((m) => m.text)
    .join('\n')
    .trim();
  if (txt) return txt;
  return (messages || []).map((m) => m && m.altText).find(Boolean) || '';
}

// ---------- 主入口：回傳 LINE 訊息陣列 ----------
export async function handleAI(groupId, userText, perms = { canManage: true, canCheckin: true }) {
  const prov = provider();
  if (!prov) {
    return [msg.text('（AI 助手尚未設定。在 Vercel 環境變數填上 GEMINI_API_KEY 或 ANTHROPIC_API_KEY 即可啟用；其他文字指令仍可正常使用，輸入「幫助」查看。）')];
  }
  const pets = await db.listPets(groupId);
  const system = systemPrompt(pets);
  // 載入這個照護圈最近的對話，給模型當記憶
  let history = [];
  try {
    history = sanitizeHistory(await db.recentChatMessages(groupId, 10));
  } catch (e) {
    console.error('load history failed', e.message);
  }
  try {
    const out = prov === 'gemini'
      ? await runGemini(groupId, userText, system, history, perms)
      : await runAnthropic(groupId, userText, system, history, perms);
    const messages = Array.isArray(out) ? out : [msg.text(String(out))];
    // 把這一輪存進記憶（先 user 後 assistant，保持時序）
    try {
      await db.saveChatMessage(groupId, 'user', userText);
      const replyText = summarizeReply(messages);
      if (replyText) await db.saveChatMessage(groupId, 'assistant', replyText);
    } catch (e) {
      console.error('save history failed', e.message);
    }
    return messages;
  } catch (e) {
    console.error('AI error', e);
    return [msg.text('小幫手剛剛恍神了一下，請稍後再試 🙏')];
  }
}

// ---------- Gemini ----------
async function runGemini(groupId, userText, system, history = [], perms = { canManage: true, canCheckin: true }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const fnDecls = TOOLS.map((t) => {
    const decl = { name: t.name, description: t.description };
    if (Object.keys(t.input_schema?.properties || {}).length > 0) decl.parameters = t.input_schema;
    return decl;
  });
  const contents = [
    ...history.map((h) => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.content }] })),
    { role: 'user', parts: [{ text: userText }] },
  ];

  for (let i = 0; i < 5; i++) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents,
        tools: [{ function_declarations: fnDecls }],
      }),
    });
    if (!resp.ok) {
      console.error('gemini error', resp.status, await resp.text().catch(() => ''));
      return [msg.text('小幫手剛剛恍神了一下，請稍後再試 🙏')];
    }
    const data = await resp.json();
    const cand = data.candidates?.[0];
    const parts = cand?.content?.parts || [];
    const calls = parts.filter((p) => p.functionCall);

    if (calls.length === 0) {
      const out = parts.filter((p) => p.text).map((p) => p.text).join('\n').trim();
      return [msg.text(out || '好的 🐾')];
    }
    const outs = [];
    for (const c of calls) {
      try {
        outs.push(await exec(groupId, c.functionCall.name, c.functionCall.args || {}, perms));
      } catch (e) {
        outs.push({ result: '執行時出錯：' + e.message });
      }
    }
    // 有富訊息（確認卡/照片）或快速模式 → 直接回；否則交回模型潤飾
    if (FAST || outs.some((o) => o.display)) return assemble(outs);
    contents.push(cand.content);
    contents.push({
      role: 'user',
      parts: calls.map((c, i) => ({
        functionResponse: { name: c.functionCall.name, response: { result: outs[i].result } },
      })),
    });
  }
  return [msg.text('處理完成 🐾')];
}

// ---------- Anthropic / Claude ----------
async function runAnthropic(groupId, userText, system, history = [], perms = { canManage: true, canCheckin: true }) {
  const messages = [
    ...history.map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content })),
    { role: 'user', content: userText },
  ];
  for (let i = 0; i < 5; i++) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 1024, system, tools: TOOLS, messages }),
    });
    if (!resp.ok) {
      console.error('anthropic error', resp.status, await resp.text().catch(() => ''));
      return [msg.text('小幫手剛剛恍神了一下，請稍後再試 🙏')];
    }
    const data = await resp.json();
    messages.push({ role: 'assistant', content: data.content });
    const toolUses = (data.content || []).filter((c) => c.type === 'tool_use');
    if (toolUses.length === 0) {
      const out = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
      return [msg.text(out || '好的 🐾')];
    }
    const outs = [];
    const results = [];
    for (const tu of toolUses) {
      let o;
      try {
        o = await exec(groupId, tu.name, tu.input || {}, perms);
      } catch (e) {
        o = { result: '執行時出錯：' + e.message };
      }
      outs.push(o);
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: o.result });
    }
    if (FAST || outs.some((o) => o.display)) return assemble(outs);
    messages.push({ role: 'user', content: results });
  }
  return [msg.text('處理完成 🐾')];
}
