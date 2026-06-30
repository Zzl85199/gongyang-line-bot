// app/api/auth/login/route.js
import { NextResponse } from 'next/server';
import { verifyPassword, signSession, SESSION_COOKIE, sessionCookieOptions } from '../../../../lib/auth.js';
import { getAppUserByEmail } from '../../../../lib/webdb.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function back(req, params) {
  const u = new URL('/login', req.url);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return NextResponse.redirect(u, 303);
}

export async function POST(req) {
  const form = await req.formData();
  const email = String(form.get('email') || '').trim().toLowerCase();
  const password = String(form.get('password') || '');
  const next = String(form.get('next') || '/app');

  const user = await getAppUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) return back(req, { error: 'bad', next });

  const res = NextResponse.redirect(new URL(next.startsWith('/') ? next : '/app', req.url), 303);
  res.cookies.set(SESSION_COOKIE, signSession(user.id), sessionCookieOptions);
  return res;
}
