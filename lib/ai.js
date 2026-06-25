// lib/ai.js
// AI 路由器：用「function calling」把使用者的一句話變成動作（新增提醒、查今天、取消打卡…）。
// 支援兩家供應商，靠環境變數切換：
//   AI_PROVIDER=gemini    → 用 Google Gemini（GEMINI_API_KEY）
//   AI_PROVIDER=anthropic → 用 Claude（ANTHROPIC_API_KEY）
// 沒設 AI_PROVIDER 時：哪個金鑰有填就用哪個（兩個都填則優先 Gemini）。
// 兩家都沒設 → AI 優雅停用，其他文字指令照常。
import * as db from './db.js';
import { parseTimes } from './time.js';

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

function provider() {
  const p = (process.env.AI_PROVIDER || '').toLowerCase();
  if (p === 'gemini') return GEMINI_KEY ? 'gemini' : null;
  if (p === 'anthropic') return ANTHROPIC_KEY ? 'anthropic' : null;
  if (GEMINI_KEY) return 'gemini';
  if (ANTHROPIC_KEY) return 'anthropic';
  return null;
}

export const aiEnabled = () => provider() !== null;

// ---------- 工具定義（與供應商無關，用 JSON schema 描述） ----------
const TOOLS = [
  { name: 'add_pet', description: '新增一隻寵物到這個照護圈',
    input_schema: { type: 'object', properties: {
      name: { type: 'string' }, species: { type: 'string', description: '狗/貓等，可省略' } }, required: ['name'] } },
  { name: 'list_pets', description: '列出這個照護圈目前有哪些寵物',
    input_schema: { type: 'object', properties: {} } },
  { name: 'add_reminder',
    description: '為某隻寵物新增一個定時提醒。kind: med(餵藥)/feed(餵食)/walk(散步)/custom(其他)。times 是 24 小時制 HH:MM 陣列。',
    input_schema: { type: 'object', properties: {
      pet_name: { type: 'string', description: '寵物名字；只有一隻時可省略' },
      kind: { type: 'string', enum: ['med', 'feed', 'walk', 'custom'] },
      name: { type: 'string', description: '提醒名稱，如「腎臟藥」「早餐」「晚間散步」' },
      times: { type: 'array', items: { type: 'string' }, description: '如 ["08:00","20:00"]' },
      emoji: { type: 'string', description: '可省略' } }, required: ['kind', 'name', 'times'] } },
  { name: 'list_reminders', description: '列出某隻寵物（或全部）目前設定的提醒',
    input_schema: { type: 'object', properties: { pet_name: { type: 'string' } } } },
  { name: 'remove_reminder', description: '刪除某個提醒（依名稱）',
    input_schema: { type: 'object', properties: {
      pet_name: { type: 'string' }, name: { type: 'string' } }, required: ['name'] } },
  { name: 'today_status', description: '查今天每隻寵物每個提醒做了沒',
    input_schema: { type: 'object', properties: {} } },
  { name: 'delete_checkin', description: '刪除今天某個提醒在某時段的打卡紀錄（誤觸時用）',
    input_schema: { type: 'object', properties: {
      pet_name: { type: 'string' }, name: { type: 'string' }, time: { type: 'string' } }, required: ['name', 'time'] } },
];

// ---------- 工具實際執行（回傳文字給模型當 tool 結果） ----------
async function exec(groupId, toolName, input) {
  switch (toolName) {
    case 'add_pet': {
      const pet = await db.addPet(groupId, input.name, input.species || null);
      return `已新增寵物：${pet.name}`;
    }
    case 'list_pets': {
      const pets = await db.listPets(groupId);
      return pets.length ? pets.map((p) => p.name).join('、') : '目前沒有任何寵物';
    }
    case 'add_reminder': {
      const pet = await db.resolvePet(groupId, input.pet_name);
      if (!pet) return '找不到對象寵物，請先告訴我是哪一隻（或先新增寵物）';
      const times = parseTimes((input.times || []).join(','));
      if (!times.length) return '時間格式看不懂，請給像 08:00 這樣的 24 小時制時間';
      const t = await db.addTask(pet, { kind: input.kind, name: input.name, times, emoji: input.emoji });
      return `已為 ${pet.name} 新增提醒：${t.name}（${times.join('、')}）`;
    }
    case 'list_reminders': {
      const pet = await db.resolvePet(groupId, input.pet_name);
      const tasks = pet ? await db.listTasks(pet.id) : await db.listTasksByGroup(groupId);
      if (!tasks.length) return '目前沒有任何提醒';
      return tasks.map((t) => `${t.name}（${t.times.join('、')}）`).join('；');
    }
    case 'remove_reminder': {
      const pet = await db.resolvePet(groupId, input.pet_name);
      if (!pet) return '找不到對象寵物';
      const t = await db.findTaskByName(pet.id, input.name);
      if (!t) return `找不到名為「${input.name}」的提醒`;
      await db.removeTask(t.id);
      return `已刪除提醒：${t.name}`;
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
      return lines.length ? lines.join('\n') : '今天還沒有任何排定的提醒';
    }
    case 'delete_checkin': {
      const pet = await db.resolvePet(groupId, input.pet_name);
      if (!pet) return '找不到對象寵物';
      const t = await db.findTaskByName(pet.id, input.name);
      if (!t) return `找不到名為「${input.name}」的提醒`;
      const ok = await db.deleteLog(t.id, input.time);
      return ok ? `已取消 ${t.name} ${input.time} 的打卡` : `今天 ${input.time} 沒有 ${t.name} 的打卡紀錄`;
    }
    default:
      return '未知的工具';
  }
}

function systemPrompt(pets) {
  return (
    '你是「共養日誌」的寵物照護小幫手，在 LINE 群組裡幫一家人管理毛孩的提醒與紀錄。' +
    '使用繁體中文、語氣親切簡短。需要動作時務必呼叫工具，不要只用講的。' +
    '時間一律換算成 24 小時制 HH:MM。' +
    `目前這個照護圈的寵物：${pets.length ? pets.map((p) => p.name).join('、') : '（還沒有）'}。`
  );
}

// ---------- 主入口 ----------
export async function handleAI(groupId, userText) {
  const prov = provider();
  if (!prov) {
    return '（AI 助手尚未設定。在 Vercel 環境變數填上 GEMINI_API_KEY 或 ANTHROPIC_API_KEY 即可啟用；其他文字指令仍可正常使用，輸入「幫助」查看。）';
  }
  const pets = await db.listPets(groupId);
  const system = systemPrompt(pets);
  try {
    return prov === 'gemini'
      ? await runGemini(groupId, userText, system)
      : await runAnthropic(groupId, userText, system);
  } catch (e) {
    console.error('AI error', e);
    return '小幫手剛剛恍神了一下，請稍後再試 🙏';
  }
}

// ---------- Gemini 實作 ----------
async function runGemini(groupId, userText, system) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  // 把工具轉成 Gemini 的 function_declarations（沒有參數的工具就不帶 parameters）
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
      return '小幫手剛剛恍神了一下，請稍後再試 🙏';
    }
    const data = await resp.json();
    const cand = data.candidates?.[0];
    const parts = cand?.content?.parts || [];
    const calls = parts.filter((p) => p.functionCall);

    if (calls.length === 0) {
      const out = parts.filter((p) => p.text).map((p) => p.text).join('\n').trim();
      return out || '好的 🐾';
    }
    contents.push(cand.content); // 模型這回合（含 functionCall）
    const respParts = [];
    for (const c of calls) {
      let out;
      try {
        out = await exec(groupId, c.functionCall.name, c.functionCall.args || {});
      } catch (e) {
        out = '執行時出錯：' + e.message;
      }
      respParts.push({ functionResponse: { name: c.functionCall.name, response: { result: out } } });
    }
    contents.push({ role: 'user', parts: respParts });
  }
  return '處理完成 🐾';
}

// ---------- Anthropic / Claude 實作 ----------
async function runAnthropic(groupId, userText, system) {
  const tools = TOOLS; // Claude 直接吃 input_schema
  const messages = [{ role: 'user', content: userText }];

  for (let i = 0; i < 5; i++) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 1024, system, tools, messages }),
    });
    if (!resp.ok) {
      console.error('anthropic error', resp.status, await resp.text().catch(() => ''));
      return '小幫手剛剛恍神了一下，請稍後再試 🙏';
    }
    const data = await resp.json();
    messages.push({ role: 'assistant', content: data.content });

    const toolUses = (data.content || []).filter((c) => c.type === 'tool_use');
    if (toolUses.length === 0) {
      const out = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
      return out || '好的 🐾';
    }
    const results = [];
    for (const tu of toolUses) {
      let out;
      try {
        out = await exec(groupId, tu.name, tu.input || {});
      } catch (e) {
        out = '執行時出錯：' + e.message;
      }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: out });
    }
    messages.push({ role: 'user', content: results });
  }
  return '處理完成 🐾';
}
