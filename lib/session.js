// lib/session.js  (server-only：用到 next/headers)
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession } from './auth.js';
import { getAppUserById } from './webdb.js';

// 從 cookie 取出目前登入的網頁帳號（沒登入回 null）
export async function getSessionUser() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const payload = verifySession(token);
  if (!payload) return null;
  return getAppUserById(payload.uid);
}
