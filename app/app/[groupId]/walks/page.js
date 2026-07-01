// app/app/[groupId]/walks/page.js
import { getSessionUser } from '../../../../lib/session.js';
import * as webdb from '../../../../lib/webdb.js';
import * as db from '../../../../lib/db.js';
import WalksManager from './WalksManager.jsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function WalksPage({ params }) {
  const groupId = decodeURIComponent(params.groupId);
  const user = await getSessionUser();
  const [access, pets] = await Promise.all([
    webdb.effectiveAccess(groupId, user),
    db.listPets(groupId),
  ]);

  const walksByPet = {};
  const walksList = await Promise.all(pets.map((p) => db.listWalkLogs(p.id, 100)));
  pets.forEach((p, i) => { walksByPet[p.id] = walksList[i]; });

  return (
    <WalksManager
      groupId={groupId}
      pets={pets.map((p) => ({ id: p.id, name: p.name }))}
      walksByPet={walksByPet}
      canEdit={webdb.canCheckin(access)}
    />
  );
}
