// lib/album.js
// 生命之書「紀念冊／回顧」網頁的連結與簡單防護 token。
import crypto from 'node:crypto';

export function albumToken(petId) {
  const secret = process.env.CRON_SECRET || 'gongyang';
  return crypto.createHash('sha256').update(`${petId}:${secret}`).digest('hex').slice(0, 12);
}

export function baseUrl() {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return '';
}

export function albumUrl(petId) {
  return `${baseUrl()}/album/${petId}?k=${albumToken(petId)}`;
}

// 交接卡（可列印、可分享）用的 token 與連結。與相簿同一套防護，但用不同前綴避免混用。
export function handoffToken(petId) {
  const secret = process.env.CRON_SECRET || 'gongyang';
  return crypto.createHash('sha256').update(`handoff:${petId}:${secret}`).digest('hex').slice(0, 12);
}
export function handoffUrl(petId) {
  return `${baseUrl()}/handoff/${petId}?k=${handoffToken(petId)}`;
}
