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
  const access = await webdb.effectiveAccess(groupId, user);

  const pets = await db.listPets(groupId);
  const walksByPet = {};
  for (const p of pets) walksByPet[p.id] = await db.listWalkLogs(p.id, 100);

  return (
    <WalksManager
      groupId={groupId}
      pets={pets.map((p) => ({ id: p.id, name: p.name }))}
      walksByPet={walksByPet}
      canEdit={webdb.canCheckin(access)}
    />
  );
}
