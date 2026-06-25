// app/api/webhook/route.js
// LINE webhook。用 req.text() 取「原始 body」做簽章驗證（這是 Next.js App Router 在 Vercel 上最穩的做法）。
import { verifySignature } from '../../../lib/line.js';
import { handleEvent } from '../../../lib/handlers.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  const raw = await req.text();
  const signature = req.headers.get('x-line-signature');

  if (!verifySignature(raw, signature)) {
    return new Response('Bad signature', { status: 401 });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response('Bad body', { status: 400 });
  }

  // 盡快回 200 給 LINE；事件處理在背景做（避免 LINE 超時重送，也減少重複投遞）
  const events = body.events || [];
  Promise.all(events.map(handleEvent)).catch((e) => console.error('webhook handle error', e));

  return Response.json({ ok: true });
}

export async function GET() {
  return new Response('共養日誌 webhook ✅');
}
