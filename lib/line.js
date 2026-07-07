// lib/line.js
// 直接用 fetch 打 LINE Messaging API，不依賴 SDK，serverless 上最乾淨。
// 簽章驗證需要「原始 body」，所以 webhook route 會用 await req.text() 取 raw body 再丟進這裡。
import crypto from 'node:crypto';

const BASE = 'https://api.line.me/v2/bot';
const DATA = 'https://api-data.line.me/v2/bot';
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const SECRET = process.env.LINE_CHANNEL_SECRET;

export function verifySignature(rawBody, signature) {
  if (!SECRET || !signature) return false;
  const hmac = crypto.createHmac('sha256', SECRET).update(rawBody).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
  } catch {
    return false;
  }
}

async function call(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    console.error('LINE API error', path, r.status, t);
  }
  return r;
}

const arr = (m) => (Array.isArray(m) ? m : [m]);

// 自我修復：若訊息字串裡殘留字面的 \uXXXX 跳脫（檔案被非 UTF-8 編輯器改壞時會發生），
// 送出前還原成真正的字元，避免使用者看到 \uD83D\uDCD6 這種亂碼。
function unescapeUnicode(s) {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
function deepDecode(v) {
  if (typeof v === 'string') return unescapeUnicode(v);
  if (Array.isArray(v)) return v.map(deepDecode);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k in v) o[k] = deepDecode(v[k]);
    return o;
  }
  return v;
}

// 回傳 { sentMessages: [{id, quoteToken}, ...] }，方便呼叫端記住「剛剛發出去的訊息 id」，
// 之後才能比對使用者「回覆」這則訊息時帶的 quotedMessageId（任務照片確認機制要用）。
async function callAndParse(path, body) {
  const r = await call(path, body);
  try {
    return await r.json();
  } catch {
    return null;
  }
}

export function reply(replyToken, messages) {
  return callAndParse('/message/reply', { replyToken, messages: arr(messages).map(deepDecode) });
}

export function push(to, messages) {
  return callAndParse('/message/push', { to, messages: arr(messages).map(deepDecode) });
}

// 從 reply()/push() 的回傳值中取出「最後一則訊息」的 message id
// （小任務卡通常只送一則訊息，取最後一則也適用於多則訊息一起送的情況）
export function lastSentMessageId(sendResult) {
  const list = sendResult?.sentMessages;
  if (!Array.isArray(list) || !list.length) return null;
  return list[list.length - 1].id || null;
}

// 取得發話者顯示名稱（群組 / 多人房 / 一對一都支援）
export async function getDisplayName(source) {
  const uid = source.userId;
  if (!uid) return '某位家人';
  let url;
  if (source.groupId) url = `${BASE}/group/${source.groupId}/member/${uid}`;
  else if (source.roomId) url = `${BASE}/room/${source.roomId}/member/${uid}`;
  else url = `${BASE}/profile/${uid}`;
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!r.ok) return '某位家人';
    const j = await r.json();
    return j.displayName || '某位家人';
  } catch {
    return '某位家人';
  }
}

// 下載使用者傳進來的圖片內容（Buffer）
export async function getMessageContent(messageId) {
  const r = await fetch(`${DATA}/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!r.ok) throw new Error('LINE content fetch failed: ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}
