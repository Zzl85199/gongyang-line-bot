// app/api/auth/line/start/route.js
import { NextResponse } from 'next/server';
import {
  lineConfigured,
  lineAuthorizeUrl,
  randomToken,
  OAUTH_STATE_COOKIE,
  OAUTH_NEXT_COOKIE,
} from '../../../../../lib/auth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (!lineConfigured()) {
    return NextResponse.redirect(new URL('/login?error=line_off', req.url), 303);
  }
  const next = new URL(req.url).searchParams.get('next') || '/app';
  const state = randomToken(16);
  const res = NextResponse.redirect(lineAuthorizeUrl(state), 303);
  // 用短效 cookie 防 CSRF + 記住登入後要去哪
  const opts = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 600 };
  res.cookies.set(OAUTH_STATE_COOKIE, state, opts);
  res.cookies.set(OAUTH_NEXT_COOKIE, next, opts);
  return res;
}
