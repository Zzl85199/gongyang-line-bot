// app/api/cron/route.js
// 由 Supabase pg_cron（或外部排程）每分鐘呼叫一次。
// 找出「現在這分鐘」要提醒的任務，用 claimReminder 在 DB 層做原子去重後推播。
// 不再依賴記憶體 Set —— serverless 多次冷啟也不會漏發或重發。
import { supa } from '../../../lib/supabase.js';
import * as db from '../../../lib/db.js';
import * as line from '../../../lib/line.js';
import * as msg from '../../../lib/messages.js';
import { hhmmTaipei } from '../../../lib/time.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function run() {
  const now = hhmmTaipei(); // 台北現在的 HH:MM
  // 取所有 active 任務，挑出 times 含有 now 的
  const { data: tasks } = await supa
    .from('tasks')
    .select('*, pets:pet_id (id, name, group_id, archived)')
    .eq('active', true);

  let pushed = 0;
  for (const task of tasks || []) {
    if (!(task.times || []).includes(now)) continue;
    const pet = task.pets;
    if (!pet || pet.archived) continue;

    const first = await db.claimReminder(task, now); // 原子去重：true 才推
    if (!first) continue;

    try {
      await line.push(task.group_id, msg.reminder(pet, task, now));
      pushed++;
    } catch (e) {
      console.error('push reminder failed', e.message);
    }
  }
  return pushed;
}

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // 沒設就不擋（建議設）
  const auth = req.headers.get('authorization');
  const key = new URL(req.url).searchParams.get('key');
  return auth === `Bearer ${secret}` || key === secret;
}

export async function GET(req) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 });
  const pushed = await run();
  return Response.json({ ok: true, pushed });
}

export async function POST(req) {
  return GET(req);
}
