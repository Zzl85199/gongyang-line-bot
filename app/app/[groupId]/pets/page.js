// app/app/[groupId]/pets/page.js
import { redirect } from 'next/navigation';
import { getSessionUser } from '../../../../lib/session.js';
import * as webdb from '../../../../lib/webdb.js';
import * as db from '../../../../lib/db.js';
import { handoffUrl } from '../../../../lib/album.js';
import PetsManager from './PetsManager.jsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function PetsPage({ params }) {
  const groupId = decodeURIComponent(params.groupId);
  const user = await getSessionUser();
  const access = await webdb.effectiveAccess(groupId, user);
  if (!webdb.canManage(access)) redirect(`/app/${groupId}`);

  const pets = await db.listAllPets(groupId);
  const group = await db.getOrCreateGroup(groupId);
  const handoffUrls = Object.fromEntries(pets.map((p) => [p.id, handoffUrl(p.id)]));

  return (
    <PetsManager
      groupId={groupId}
      pets={pets.map((p) => ({
        id: p.id, name: p.name, species: p.species, birthday: p.birthday,
        health: p.health, archived: p.archived, care_state: p.care_state, handoff_config: p.handoff_config,
      }))}
      group={{ duty_rotation: group.duty_rotation || [], overdue_minutes: group.overdue_minutes || 0 }}
      handoffUrls={handoffUrls}
    />
  );
}
