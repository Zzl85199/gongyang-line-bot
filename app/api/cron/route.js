// app/api/cron/route.js
// 由 Supabase pg_cron（或外部排程）每分鐘呼叫一次。處理三件事：
//   1) 到點的定時提醒（含「今天輪到誰」）
//   2) 一次性提醒（順延 / 晚點再提醒）
//   3) 過時補提醒（超過設定分鐘還沒打卡，補一次）
// 全部用 DB 層唯一鍵去重，serverless 多次冷啟也不會漏 / 重發。
import { supa } from '../../../lib/supabase.js';
import * as db from '../../../lib/db.js';
import * as line from '../../../lib/line.js';
import * as msg from '../../../lib/messages.js';
import { hhmmTaipei, dateKeyTaipei } from '../../../lib/time.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map((x) => parseInt(x, 10));
  return h * 60 + m;
};

async function run() {
  const now = hhmmTaipei();
  const nowMin = toMin(now);
  const today = dateKeyTaipei();

  const { data: tasks } = await supa
    .from('tasks')
    .select('*, pets:pet_id (id, name, group_id, archived)')
    .eq('active', true);

  const groupRows = await db.allGroupRows();
  const groupMap = Object.fromEntries(groupRows.map((g) => [g.id, g]));

  let pushed = 0;

  for (const task of tasks || []) {
    const pet = task.pets;
    if (!pet || pet.archived) continue;
    const g = groupMap[task.group_id];
    const duty = g ? db.dutyToday(g) : null;
    const od = g?.overdue_minutes || 0;

    for (const slot of task.times || []) {
      // 1) 到點提醒
      if (slot === now && (await db.claimReminder(task, slot))) {
        try {
          await line.push(task.group_id, msg.reminder(pet, task, slot, duty));
          pushed++;
        } catch (e) {
          console.error('push reminder failed', e.message);
        }
      }
      // 3) 過時補提醒
      if (od > 0) {
        const elapsed = nowMin - toMin(slot);
        if (elapsed >= od && elapsed < od + 60) {
          const done = await db.getLog(task.id, slot, today);
          if (!done && (await db.claimOverdue(task, slot))) {
            try {
              await line.push(task.group_id, msg.overdueReminder(pet, task, slot, duty));
              pushed++;
            } catch (e) {
              console.error('push overdue failed', e.message);
            }
          }
        }
      }
    }
  }

  // 2) 一次性提醒（順延 / 晚點再提醒）
  const oneoffs = await db.dueOneoffs();
  for (const o of oneoffs) {
    const pet = o.pets;
    try {
      if (pet && !pet.archived) {
        let m = null;
        if (o.task_id) {
          const task = await db.getTask(o.task_id);
          if (task) m = msg.reminder(pet, task, o.scheduled_time || hhmmTaipei(), null);
        }
        if (!m) m = msg.text(`⏰ 提醒：${pet.name} ${o.label}`);
        await line.push(o.group_id, m);
        pushed++;
      }
    } catch (e) {
      console.error('push oneoff failed', e.message);
    }
    await db.markOneoffSent(o.id);
  }

  return pushed;
}

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
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
