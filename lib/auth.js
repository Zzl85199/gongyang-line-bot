// lib/auth.js
// 網頁登入：無外部套件，全部用 node:crypto。
//   - Session：簽章 cookie（HMAC），不需 DB session 表。
//   - 密碼：pbkdf2 雜湊（不需 bcrypt）。
//   - LINE Login：標準 OAuth2；與 Messaging API 同 provider 時 userId 會一致。
import crypto from 'node:crypto';
import { baseUrl } from './album.js';

const SECRET = process.env.AUTH_SECRET || process.env.CRON_SECRET || 'gongyang-dev-secret';
export const SESSION_COOKIE = 'gy_session';
export const OAUTH_STATE_COOKIE = 'gy_oauth_state';
export const OAUTH_NEXT_COOKIE = 'gy_oauth_next';
const SESSION_DAYS = 30;

// ---------- base64url ----------
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}
function hmac(s) {
  return b64url(crypto.createHmac('sha256', SECRET).update(s).digest());
}

// ---------- session ----------
export function signSession(userId) {
  const body = b64url(JSON.stringify({ uid: userId, exp: Date.now() + SESSION_DAYS * 86400000 }));
  return `${body}.${hmac(body)}`;
}
export function verifySession(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  // timing-safe 比對
  const expected = hmac(body);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(fromB64url(body));
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}
export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: SESSION_DAYS * 86400,
};
export const clearedCookieOptions = { ...sessionCookieOptions, maxAge: 0 };

// ---------- password ----------
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.pbkdf2Sync(pw, salt, 120000, 32, 'sha256').toString('hex');
  return `pbkdf2$120000$${salt}$${h}`;
}
export function verifyPassword(pw, stored) {
  if (!stored) return false;
  const [scheme, iter, salt, h] = stored.split('$');
  if (scheme !== 'pbkdf2') return false;
  const calc = crypto.pbkdf2Sync(pw, salt, Number(iter), 32, 'sha256').toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(h));
  } catch {
    return false;
  }
}

// ---------- LINE Login (OAuth2) ----------
const LINE_AUTH = 'https://access.line.me/oauth2/v2.1/authorize';
const LINE_TOKEN = 'https://api.line.me/oauth2/v2.1/token';
const LINE_PROFILE = 'https://api.line.me/v2/profile';

export function lineConfigured() {
  return Boolean(process.env.LINE_LOGIN_CHANNEL_ID && process.env.LINE_LOGIN_CHANNEL_SECRET);
}
export function lineRedirectUri() {
  return `${baseUrl()}/api/auth/line/callback`;
}
export function lineAuthorizeUrl(state) {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.LINE_LOGIN_CHANNEL_ID,
    redirect_uri: lineRedirectUri(),
    state,
    scope: 'profile openid',
  });
  return `${LINE_AUTH}?${p.toString()}`;
}
export async function exchangeLineCode(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: lineRedirectUri(),
    client_id: process.env.LINE_LOGIN_CHANNEL_ID,
    client_secret: process.env.LINE_LOGIN_CHANNEL_SECRET,
  });
  const r = await fetch(LINE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) throw new Error('LINE token exchange failed: ' + r.status);
  return r.json(); // { access_token, id_token, ... }
}
export async function getLineProfile(accessToken) {
  const r = await fetch(LINE_PROFILE, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error('LINE profile failed: ' + r.status);
  return r.json(); // { userId, displayName, pictureUrl }
}

export function randomToken(n = 24) {
  return crypto.randomBytes(n).toString('hex');
}
