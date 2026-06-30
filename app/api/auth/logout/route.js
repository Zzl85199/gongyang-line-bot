// app/api/auth/logout/route.js
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, clearedCookieOptions } from '../../../../lib/auth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function logout(req) {
  const res = NextResponse.redirect(new URL('/login', req.url), 303);
  res.cookies.set(SESSION_COOKIE, '', clearedCookieOptions);
  return res;
}
export async function POST(req) {
  return logout(req);
}
export async function GET(req) {
  return logout(req);
}
