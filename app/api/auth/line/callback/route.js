// app/api/auth/line/callback/route.js
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  exchangeLineCode,
  getLineProfile,
  signSession,
  SESSION_COOKIE,
  sessionCookieOptions,
  OAUTH_STATE_COOKIE,
  OAUTH_NEXT_COOKIE,
} from '../../../../../lib/auth.js';
import { upsertLineUser } from '../../../../../lib/webdb.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const jar = cookies();
  const savedState = jar.get(OAUTH_STATE_COOKIE)?.value;
  const next = jar.get(OAUTH_NEXT_COOKIE)?.value || '/app';

  const fail = (e) => NextResponse.redirect(new URL(`/login?error=${e}`, req.url), 303);
  if (!code || !state || !savedState || state !== savedState) return fail('oauth_state');

  let user;
  try {
    const tok = await exchangeLineCode(code);
    const profile = await getLineProfile(tok.access_token);
    if (!profile?.userId) return fail('oauth_profile');
    user = await upsertLineUser({ lineUserId: profile.userId, displayName: profile.displayName });
  } catch (e) {
    console.error('LINE login failed', e.message);
    return fail('oauth');
  }

  const res = NextResponse.redirect(new URL(next.startsWith('/') ? next : '/app', req.url), 303);
  res.cookies.set(SESSION_COOKIE, signSession(user.id), sessionCookieOptions);
  res.cookies.set(OAUTH_STATE_COOKIE, '', { path: '/', maxAge: 0 });
  res.cookies.set(OAUTH_NEXT_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
