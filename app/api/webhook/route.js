// app/api/webhook/route.js
// LINE webhook。用 req.text() 取原始 body 做簽章驗證。
// 關鍵：用 waitUntil() 讓「回完 200 之後」的回覆工作確實跑完。
// serverless 在送出回應後就會結束，沒包 waitUntil 的背景工作會被砍掉 → 表現為「隔好久才回」。
import { waitUntil } from '@vercel/functions';
import { verifySignature } from '../../../lib/line.js';
import { handleEvent } from '../../../lib/handlers.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 給 AI 回合多一點時間

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

  const events = body.events || [];
  // 立刻回 200 給 LINE（避免 LINE 逾時重送），但用 waitUntil 確保回覆工作不被砍掉
  waitUntil(
    Promise.all(events.map(handleEvent)).catch((e) => console.error('webhook handle error', e))
  );

  return Response.json({ ok: true });
}

export async function GET() {
  return new Response('共養日誌 webhook ✅');
}
