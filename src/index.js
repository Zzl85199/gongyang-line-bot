require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cron = require('node-cron');
const line = require('@line/bot-sdk');

const store = require('./store');
const { pickTask } = require('./tasks');
const msg = require('./messages');

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new line.Client(config);
const app = express();
const TZ = 'Asia/Taipei';

// ---------- 時間工具(以台北時區為準) ----------
function dateKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
}
function hhmm() {
  return new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }); // HH:MM
}
function nowIso() {
  return new Date().toISOString();
}
function normalizeTime(s) {
  const m = String(s).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = String(Math.min(23, parseInt(m[1], 10))).padStart(2, '0');
  return `${h}:${m[2]}`;
}

// ---------- LINE 來源 / 名稱 ----------
function targetId(event) {
  const s = event.source;
  return s.groupId || s.roomId || s.userId;
}
async function getDisplayName(event) {
  const s = event.source;
  const userId = s.userId;
  if (!userId) return '某位家人';
  try {
    let prof;
    if (s.groupId) prof = await client.getGroupMemberProfile(s.groupId, userId);
    else if (s.roomId) prof = await client.getRoomMemberProfile(s.roomId, userId);
    else prof = await client.getProfile(userId);
    return prof.displayName || '某位家人';
  } catch {
    return '某位家人';
  }
}

// ---------- Webhook ----------
app.get('/', (_req, res) => res.send('共養日誌 LINE bot is running ✅'));

app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    await Promise.all((req.body.events || []).map(handleEvent));
    res.json({ ok: true });
  } catch (e) {
    console.error('handleEvent error:', e);
    res.status(500).end();
  }
});

async function handleEvent(event) {
  const id = targetId(event);
  if (event.type === 'join' || event.type === 'follow') {
    return reply(event, msg.welcome());
  }
  if (event.type === 'message' && event.message.type === 'text') {
    return handleText(event, id, event.message.text.trim());
  }
  if (event.type === 'message' && event.message.type === 'image') {
    return handleImage(event, id);
  }
  if (event.type === 'postback') {
    return handlePostback(event, id);
  }
  return null;
}

function reply(event, message) {
  return client.replyMessage(event.replyToken, Array.isArray(message) ? message : [message]);
}

// ---------- 文字指令 ----------
async function handleText(event, id, t) {
  const g = store.getGroup(id);

  if (/^(幫助|help|指令)$/i.test(t)) return reply(event, msg.help());

  let m;
  if ((m = t.match(/^綁定\s*(.+)$/))) {
    g.petName = m[1].trim();
    store.save();
    return reply(event, msg.text(`好的,已經綁定毛孩:${g.petName} 🐾\n接下來可以「新增用藥 藥名 08:00,20:00」設定餵藥提醒。`));
  }

  if ((m = t.match(/^新增用藥\s+(\S+)\s+(.+)$/))) {
    const name = m[1];
    const times = m[2].split(/[,，、\s]+/).map(normalizeTime).filter(Boolean);
    if (times.length === 0) return reply(event, msg.text('時間格式看不懂,請用像「08:00,20:00」這樣的格式。'));
    g.meds.push({ id: 'med' + Date.now(), name, times });
    store.save();
    return reply(event, msg.text(`已新增用藥:${name}(${times.join('、')})\n到時間我會在群裡提醒。`));
  }

  if (/^用藥清單$/.test(t)) {
    if (g.meds.length === 0) return reply(event, msg.text('目前還沒有設定任何用藥。'));
    const lines = g.meds.map((md) => `・${md.name}（${md.times.join('、')}）`).join('\n');
    return reply(event, msg.text('目前的用藥:\n' + lines));
  }

  if ((m = t.match(/^(任務|來個任務|來一個任務)(?:\s*(簡單|中等|困難))?$/))) {
    const diff = m[2] || g.difficulty;
    return sendTask(event, g, diff);
  }

  if ((m = t.match(/^難度\s*(簡單|中等|困難)$/))) {
    g.difficulty = m[1];
    store.save();
    return reply(event, msg.text(`好,自動任務的預設難度設為「${g.difficulty}」。`));
  }

  if ((m = t.match(/^頻率\s*(\d+)$/))) {
    g.taskIntervalDays = Math.max(1, parseInt(m[1], 10));
    store.save();
    return reply(event, msg.text(`好,我會每 ${g.taskIntervalDays} 天自動出一個任務。`));
  }

  if (/^設定$/.test(t)) {
    return reply(
      event,
      msg.text(
        `目前設定\n毛孩:${g.petName || '(尚未綁定)'}\n用藥:${g.meds.length} 筆\n` +
          `任務難度:${g.difficulty}\n自動任務頻率:每 ${g.taskIntervalDays} 天\n生命之書:${g.lifebook.length} 個時光`
      )
    );
  }

  if (/^生命之書$/.test(t)) {
    const lb = g.lifebook;
    if (lb.length === 0) return reply(event, msg.text('生命之書還是空的 📖\n完成一個任務、把照片傳進來,就是第一頁。'));
    const recent = lb.slice(-5).reverse().map((e) => {
      const d = e.at ? e.at.slice(0, 10) : '';
      return `・${d} ${e.taskTitle || '日常時光'}（${e.by || ''}）`;
    }).join('\n');
    return reply(event, msg.text(`📖 ${g.petName || '毛孩'}的生命之書\n已收藏 ${lb.length} 個時光,最近的:\n${recent}`));
  }

  // 其他訊息不回應,避免在群組裡製造噪音
  return null;
}

async function sendTask(event, g, difficulty) {
  const t = pickTask(difficulty, g.lastTaskId);
  g.lastTaskId = t.id;
  g.pendingTask = { id: t.id, title: t.title, difficulty: t.difficulty, assignedAt: nowIso() };
  store.save();
  return reply(event, msg.task(t, t.difficulty, g.petName));
}

// ---------- 圖片 → 生命之書 ----------
async function handleImage(event, id) {
  const g = store.getGroup(id);
  const by = await getDisplayName(event);

  let photoPath = null;
  try {
    const stream = await client.getMessageContent(event.message.id);
    const dir = path.join(__dirname, '..', 'data', 'photos', id.replace(/[^A-Za-z0-9_-]/g, '_'));
    fs.mkdirSync(dir, { recursive: true });
    photoPath = path.join(dir, `${Date.now()}.jpg`);
    await new Promise((res, rej) => {
      const w = fs.createWriteStream(photoPath);
      stream.pipe(w);
      w.on('finish', res);
      w.on('error', rej);
    });
  } catch (e) {
    console.error('save photo failed:', e);
  }

  if (g.pendingTask) {
    g.lifebook.push({
      type: 'task',
      taskTitle: g.pendingTask.title,
      difficulty: g.pendingTask.difficulty,
      photo: photoPath,
      by,
      at: nowIso(),
    });
    const title = g.pendingTask.title;
    g.pendingTask = null;
    store.save();
    return reply(event, msg.text(`收進生命之書了 📖✨\n「${title}」完成 —— 謝謝你陪${g.petName || '牠'}度過這一刻。`));
  }

  g.lifebook.push({ type: 'memory', photo: photoPath, by, at: nowIso() });
  store.save();
  return reply(event, msg.text('這一刻收進生命之書了 📖'));
}

// ---------- Postback(按鈕) ----------
async function handlePostback(event, id) {
  const g = store.getGroup(id);
  const data = new URLSearchParams(event.postback.data);
  const action = data.get('action');

  if (action === 'med_done') {
    const medId = data.get('medId');
    const time = data.get('time');
    const day = dateKey();
    const slot = `${medId}@${time}`;
    g.medLog[day] = g.medLog[day] || {};

    // 防重複給藥:同一單處理是同步的,先按的人贏
    if (g.medLog[day][slot] && g.medLog[day][slot].done) {
      const who = g.medLog[day][slot].byName || '家人';
      const at = (g.medLog[day][slot].at || '').slice(11, 16);
      return reply(event, msg.text(`這次（${time}）已經由 ${who} 在 ${at} 餵過囉,不用再給一次 🐾`));
    }
    const byName = await getDisplayName(event);
    g.medLog[day][slot] = { done: true, by: event.source.userId || null, byName, at: nowIso() };
    store.save();
    return reply(event, msg.text(`✅ ${byName} 已完成 ${time} 的餵藥`));
  }

  if (action === 'new_task') {
    return sendTask(event, g, g.difficulty);
  }

  return null;
}

// ---------- 排程:餵藥提醒(每分鐘檢查) ----------
const remindedToday = new Set();
let remindedDay = dateKey();
cron.schedule(
  '* * * * *',
  async () => {
    const day = dateKey();
    if (day !== remindedDay) {
      remindedToday.clear();
      remindedDay = day;
    }
    const now = hhmm();
    const groups = store.allGroups();
    for (const [gid, g] of Object.entries(groups)) {
      for (const md of g.meds || []) {
        if ((md.times || []).includes(now)) {
          const key = `${day}-${gid}-${md.id}-${now}`;
          if (remindedToday.has(key)) continue;
          remindedToday.add(key);
          try {
            await client.pushMessage(gid, msg.reminder(g.petName, md.name, now, md.id));
          } catch (e) {
            console.error('push reminder failed:', e.message);
          }
        }
      }
    }
  },
  { timezone: TZ }
);

// ---------- 排程:生命之書任務(每天 11:00 檢查) ----------
cron.schedule(
  '0 11 * * *',
  async () => {
    const groups = store.allGroups();
    for (const [gid, g] of Object.entries(groups)) {
      if (!g.petName) continue;
      const due =
        !g.lastTaskPushAt ||
        (Date.now() - new Date(g.lastTaskPushAt).getTime()) / 86400000 >= (g.taskIntervalDays || 3);
      if (!due) continue;
      const t = pickTask(g.difficulty, g.lastTaskId);
      g.lastTaskId = t.id;
      g.lastTaskPushAt = nowIso();
      g.pendingTask = { id: t.id, title: t.title, difficulty: t.difficulty, assignedAt: nowIso() };
      store.save();
      try {
        await client.pushMessage(gid, msg.task(t, t.difficulty, g.petName));
      } catch (e) {
        console.error('push task failed:', e.message);
      }
    }
  },
  { timezone: TZ }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`共養日誌 LINE bot listening on :${PORT}`));
