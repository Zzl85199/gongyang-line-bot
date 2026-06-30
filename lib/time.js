// lib/time.js
// 一律以「台北時區」處理顯示與排程。
// 舊版的 bug 根因：把 UTC 的 ISO 字串用 .slice(11,16) 硬切當本地時間，固定差 8 小時。
// 這裡所有對外顯示一律用 Intl + timeZone，DB 一律存 UTC timestamptz，徹底分離「儲存」與「顯示」。

export const TZ = 'Asia/Taipei';

function partsInTz(date = new Date(), tz = TZ) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  // Intl 偶爾會把午夜表示成 '24'，統一成 '00'
  if (p.hour === '24') p.hour = '00';
  return p;
}

// ---- 任意時區版本（給「每隻寵物/每個照護圈可設不同國家時區」用；排程比對的核心）----
export function hhmmInTz(date, tz) {
  const p = partsInTz(date, tz);
  return `${p.hour}:${p.minute}`;
}
export function dateKeyInTz(date, tz) {
  const p = partsInTz(date, tz);
  return `${p.year}-${p.month}-${p.day}`;
}
export function weekdayInTz(date, tz) {
  const [y, m, d] = dateKeyInTz(date, tz).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
export function weekKeyInTz(date, tz) {
  const [y, m, d] = dateKeyInTz(date, tz).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const ft = (firstThursday.getUTCDay() + 6) % 7;
  const week = 1 + Math.round(((dt - firstThursday) / 86400000 - 3 + ft) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// 台北「日期」key，例如 2026-06-25（一天的界線以台北為準，跨午夜不會錯算）
export function dateKeyTaipei(date = new Date()) {
  const p = partsInTz(date);
  return `${p.year}-${p.month}-${p.day}`;
}

// 台北「現在」的 HH:MM（排程比對用）
export function hhmmTaipei(date = new Date()) {
  const p = partsInTz(date);
  return `${p.hour}:${p.minute}`;
}

// 把 DB 存的 UTC 時間，正確轉成台北 HH:MM 來顯示（取代舊版 .slice(11,16)）
export function fmtTaipeiHHMM(isoOrDate) {
  if (!isoOrDate) return '';
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  return hhmmTaipei(d);
}

// 解析使用者輸入的時間，接受 8:00 / 08:00 / 8：00（全形冒號），輸出標準 HH:MM
export function normalizeTime(s) {
  const m = String(s).trim().match(/^(\d{1,2})[:：](\d{2})$/);
  if (!m) return null;
  const h = Math.min(23, parseInt(m[1], 10));
  const mi = Math.min(59, parseInt(m[2], 10));
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

// 一段字串拆成多個時間，例如 "08:00,20:00" / "08:00、20:00 早上7:00"
export function parseTimes(s) {
  return String(s)
    .split(/[,，、\s]+/)
    .map(normalizeTime)
    .filter(Boolean);
}

// 台北日期的星期幾（0=週日 … 6=週六），用於每週任務排程
export function weekdayTaipei(date = new Date()) {
  const [y, m, d] = dateKeyTaipei(date).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// 台北日期所屬的 ISO 週次 key，例如 2026-W26（每週任務去重用）
export function weekKeyTaipei(date = new Date()) {
  const [y, m, d] = dateKeyTaipei(date).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = (dt.getUTCDay() + 6) % 7; // 週一=0
  dt.setUTCDate(dt.getUTCDate() - day + 3); // 移到當週的週四
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const ft = (firstThursday.getUTCDay() + 6) % 7;
  const week = 1 + Math.round(((dt - firstThursday) / 86400000 - 3 + ft) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// 把「今天台北的 HH:MM」轉成 ISO（UTC）時間字串，用於排一次性提醒
export function taipeiTimeToISO(hhmm, base = new Date()) {
  const key = dateKeyTaipei(base); // YYYY-MM-DD（台北）
  const d = new Date(`${key}T${hhmm}:00+08:00`);
  return d.toISOString();
}
