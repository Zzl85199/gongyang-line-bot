// app/app/[groupId]/schedule/page.js
import { getSessionUser } from '../../../../lib/session.js';
import * as webdb from '../../../../lib/webdb.js';
import * as db from '../../../../lib/db.js';
import ScheduleManager from './ScheduleManager.jsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function SchedulePage({ params }) {
  const groupId = decodeURIComponent(params.groupId);
  const user = await getSessionUser();
  const access = await webdb.effectiveAccess(groupId, user);

  const pets = await db.listPets(groupId); // 不含紀念
  const petName = Object.fromEntries(pets.map((p) => [p.id, p.name]));
  const rawTasks = await db.listTasksByGroup(groupId);
  const toMin = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map((x) => parseInt(x, 10));
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 24 * 60 + 1; // 沒時間的排最後
  };
  const tasks = rawTasks
    .filter((t) => petName[t.pet_id]) // 隱藏紀念寵物的任務
    .map((t) => ({
      id: t.id,
      kind: t.kind,
      name: t.name,
      times: (t.times || []).slice().sort(),
      dosage: t.dosage || null,
      petName: petName[t.pet_id],
    }))
    // 依「最早的時段」由早到晚排，看起來像一天的時間軸；同時間再依寵物名稱穩定排序
    .sort((a, b) => {
      const ea = a.times.length ? toMin(a.times[0]) : 24 * 60 + 1;
      const eb = b.times.length ? toMin(b.times[0]) : 24 * 60 + 1;
      if (ea !== eb) return ea - eb;
      return a.petName.localeCompare(b.petName, 'zh-Hant');
    });

  return (
    <ScheduleManager
      groupId={groupId}
      pets={pets.map((p) => ({ id: p.id, name: p.name, archived: p.archived }))}
      tasks={tasks}
      canManage={webdb.canManage(access)}
    />
  );
}
