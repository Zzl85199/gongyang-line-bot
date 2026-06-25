// lib/ai.js
// AI 路由器：用 function calling 把使用者的一句話變成動作。
// 供應商切換：AI_PROVIDER=gemini / anthropic（留空則哪個金鑰有填用哪個，兩個都有先 Gemini）。
// 回傳：一律是「LINE 訊息陣列」(handlers 直接拿去回覆)，這樣才能回照片輪播、確認卡等富訊息。
import * as db from './db.js';
import * as msg from './messages.js';
import { parseTimes, taipeiTimeToISO, hhmmTaipei } from './time.js';

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
      emoji: { type: 'string' } }, required: ['kind', 'name', 'times'] } },
  { name: 'edit_reminder', description: '修改某個提醒的時間（整批取代）',
    input_schema: { type: 'object', properties: {
      pet_name: { type: 'string' }, name: { type: 'string' },
      times: { type: 'array', items: { type: 'string' }, description: '新的 HH:MM 陣列' } }, required: ['name', 'times'] } },
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
];

// ---------- 工具執行：回 { result(文字), display?(LINE 訊息陣列) } ----------
async function exec(groupId, toolName, input) {
  const r = (result, display) => (display ? { result, display } : { result });
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
      const t = await db.addTask(pet, { kind: input.kind, name: input.name, times, emoji: input.emoji });
      return r(`已為 ${pet.name} 新增提醒：${t.name}（${times.join('、')}）`);
    }
    case 'edit_reminder': {
      const pet = await db.resolvePet(groupId, input.pet_name);
      if (!pet) return r('找不到對象寵物');
      const t = await db.findTaskByName(pet.id, input.name);
      if (!t) return r(`找不到名為「${input.name}」的提醒`);
      const times = parseTimes((input.times || []).join(','));
      if (!times.length) return r('時間格式看不懂');
      await db.updateTaskTimes(t.id, times);
      return r(`已把 ${pet.name} 的「${t.name}」改成 ${times.join('、')}`);
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
    default:
      return r('未知的工具');
  }
}

function systemPrompt(pets) {
  return (
    '你是「共養日誌」的寵物照護小幫手，在 LINE 群組裡幫一家人管理毛孩的提醒與紀錄。' +
    '使用繁體中文、語氣親切簡短。需要動作時務必呼叫工具，不要只用講的。時間一律換算成 24 小時制 HH:MM。' +
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

// ---------- 主入口：回傳 LINE 訊息陣列 ----------
export async function handleAI(groupId, userText) {
  const prov = provider();
  if (!prov) {
    return [msg.text('（AI 助手尚未設定。在 Vercel 環境變數填上 GEMINI_API_KEY 或 ANTHROPIC_API_KEY 即可啟用；其他文字指令仍可正常使用，輸入「幫助」查看。）')];
  }
  const pets = await db.listPets(groupId);
  const system = systemPrompt(pets);
  try {
    const out = prov === 'gemini'
      ? await runGemini(groupId, userText, system)
      : await runAnthropic(groupId, userText, system);
    return Array.isArray(out) ? out : [msg.text(String(out))];
  } catch (e) {
    console.error('AI error', e);
    return [msg.text('小幫手剛剛恍神了一下，請稍後再試 🙏')];
  }
}

// ---------- Gemini ----------
async function runGemini(groupId, userText, system) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const fnDecls = TOOLS.map((t) => {
    const decl = { name: t.name, description: t.description };
    if (Object.keys(t.input_schema?.properties || {}).length > 0) decl.parameters = t.input_schema;
    return decl;
  });
  const contents = [{ role: 'user', parts: [{ text: userText }] }];

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
        outs.push(await exec(groupId, c.functionCall.name, c.functionCall.args || {}));
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
async function runAnthropic(groupId, userText, system) {
  const messages = [{ role: 'user', content: userText }];
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
        o = await exec(groupId, tu.name, tu.input || {});
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
