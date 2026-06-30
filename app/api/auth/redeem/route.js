// app/api/auth/redeem/route.js
// 兌換對外授權邀請連結：登入後把這條 grant 綁到自己的帳號，之後就能看到該照護圈。
import { NextResponse } from 'next/server';
import { getSessionUser } from '../../../../lib/session.js';
import * as webdb from '../../../../lib/webdb.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  const user = await getSessionUser();
  const form = await req.formData();
  const token = String(form.get('token') || '');

  if (!user) {
    const next = encodeURIComponent(`/join?token=${token}`);
    return NextResponse.redirect(new URL(`/login?error=need_login&next=${next}`, req.url), 303);
  }

  const grant = await webdb.getGrantByToken(token);
  if (!grant) return NextResponse.redirect(new URL('/join?bad=1', req.url), 303);

  // 已被別人兌換 → 拒絕（一條邀請對一個人）
  if (grant.app_user_id && grant.app_user_id !== user.id) {
    return NextResponse.redirect(new URL('/join?taken=1', req.url), 303);
  }
  if (!grant.app_user_id) await webdb.redeemGrant(grant, user.id);

  return NextResponse.redirect(new URL(`/app/${grant.group_id}`, req.url), 303);
}
