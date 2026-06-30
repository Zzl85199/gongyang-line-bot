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
  const tasks = rawTasks
    .filter((t) => petName[t.pet_id]) // 隱藏紀念寵物的任務
    .map((t) => ({
      id: t.id,
      kind: t.kind,
      name: t.name,
      times: (t.times || []).slice().sort(),
      dosage: t.dosage || null,
      petName: petName[t.pet_id],
    }));

  return (
    <ScheduleManager
      groupId={groupId}
      pets={pets.map((p) => ({ id: p.id, name: p.name, archived: p.archived }))}
      tasks={tasks}
      canManage={webdb.canManage(access)}
    />
  );
}
