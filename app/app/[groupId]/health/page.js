// app/app/[groupId]/health/page.js
import { getSessionUser } from '../../../../lib/session.js';
import * as webdb from '../../../../lib/webdb.js';
import * as db from '../../../../lib/db.js';
import HealthManager from './HealthManager.jsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function HealthPage({ params }) {
  const groupId = decodeURIComponent(params.groupId);
  const user = await getSessionUser();
  const [access, pets] = await Promise.all([
    webdb.effectiveAccess(groupId, user),
    db.listAllPets(groupId), // 含紀念，方便回看病史
  ]);

  const logsByPet = {};
  const logsList = await Promise.all(pets.map((p) => db.allHealthLogs(p.id, 200)));
  pets.forEach((p, i) => { logsByPet[p.id] = logsList[i]; });

  return (
    <HealthManager
      groupId={groupId}
      pets={pets.map((p) => ({ id: p.id, name: p.name, archived: p.archived }))}
      logsByPet={logsByPet}
      canEdit={webdb.canCheckin(access)}
    />
  );
}
