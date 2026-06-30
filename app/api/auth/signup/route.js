// app/api/auth/signup/route.js
import { NextResponse } from 'next/server';
import { hashPassword, signSession, SESSION_COOKIE, sessionCookieOptions } from '../../../../lib/auth.js';
import { getAppUserByEmail, createEmailUser } from '../../../../lib/webdb.js';

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
  const name = String(form.get('name') || '').trim();
  const next = String(form.get('next') || '/app');

  if (!email || !password) return back(req, { error: 'missing', next, mode: 'signup' });
  if (password.length < 6) return back(req, { error: 'weak', next, mode: 'signup' });
  if (await getAppUserByEmail(email)) return back(req, { error: 'exists', next, mode: 'signup' });

  let user;
  try {
    user = await createEmailUser({ email, passwordHash: hashPassword(password), displayName: name || email.split('@')[0] });
  } catch {
    return back(req, { error: 'server', next, mode: 'signup' });
  }

  const res = NextResponse.redirect(new URL(next.startsWith('/') ? next : '/app', req.url), 303);
  res.cookies.set(SESSION_COOKIE, signSession(user.id), sessionCookieOptions);
  return res;
}
