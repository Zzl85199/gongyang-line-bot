// app/app/[groupId]/page.js
// 今日狀態總覽：把每隻寵物今天該做的每個時段，標上「誰做了沒」，交給 TodayBoard 互動打卡。
import { getSessionUser } from '../../../lib/session.js';
import * as webdb from '../../../lib/webdb.js';
import * as db from '../../../lib/db.js';
import { albumUrl } from '../../../lib/album.js';
import { fmtTaipeiHHMM } from '../../../lib/time.js';
import TodayBoard from './TodayBoard.jsx';
import { h1, sub } from '../ui.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function Today({ params }) {
  const groupId = decodeURIComponent(params.groupId);
  const user = await getSessionUser();
  const access = await webdb.effectiveAccess(groupId, user);

  const pets = (await db.listPets(groupId)); // 不含紀念
  const tasks = await db.listTasksByGroup(groupId);
  const logs = await db.todayLogs(groupId); // 今天所有打卡

  const doneMap = new Map(); // `${taskId}|${slot}` -> { byName }
  for (const l of logs) doneMap.set(`${l.task_id}|${l.scheduled_time}`, { byName: l.done_by_name, at: fmtTaipeiHHMM(l.done_at) });

  const data = pets.map((pet) => {
    const petTasks = tasks.filter((t) => t.pet_id === pet.id);
    // 攤平成「這隻毛孩今天所有時段」的單一陣列，再依時間排序——
    // 之前是「一個提醒排完接著排下一個提醒」，同一隻毛孩不同提醒的時段不會照時間先後顯示。
    const items = [];
    for (const t of petTasks) {
      for (const time of (t.times || []).slice().sort()) {
        const hit = doneMap.get(`${t.id}|${time}`);
        items.push({
          taskId: t.id,
          name: t.name,
          emoji: t.emoji,
          dosage: t.dosage || null,
          time,
          done: Boolean(hit),
          byName: hit?.byName || null,
        });
      }
    }
    items.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    const url = albumUrl(pet.id);
    return { id: pet.id, name: pet.name, archived: pet.archived, albumUrl: url.startsWith('http') ? url : null, items };
  });

  const today = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date());

  return (
    <div>
      <h1 style={{ ...h1, marginTop: 12 }}>今天</h1>
      <p style={{ ...sub, marginBottom: 14 }}>{today}・做好了點一下，全家同步看得到</p>
      <TodayBoard groupId={groupId} initialPets={data} canCheckin={webdb.canCheckin(access)} />
    </div>
  );
}
