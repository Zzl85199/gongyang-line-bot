// app/app/[groupId]/album/page.js
import { getSessionUser } from '../../../../lib/session.js';
import * as webdb from '../../../../lib/webdb.js';
import * as db from '../../../../lib/db.js';
import AlbumManager from './AlbumManager.jsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function AlbumPage({ params }) {
  const groupId = decodeURIComponent(params.groupId);
  const user = await getSessionUser();
  const access = await webdb.effectiveAccess(groupId, user);

  const pets = await db.listAllPets(groupId);
  const collectionsByPet = {};
  const entriesByPet = {};
  for (const p of pets) {
    collectionsByPet[p.id] = await db.listAllCollections(p.id);
    const rows = (await db.recentLifebook(p.id, 300)).filter((e) => e.photo_path);
    const urls = await Promise.all(rows.map((e) => db.signedPhotoUrl(e.photo_path, 3600)));
    entriesByPet[p.id] = rows.map((e, i) => ({
      id: e.id,
      url: urls[i],
      caption: e.caption || '',
      collection_key: e.collection_key || null,
      by_name: e.by_name || null,
      created_at: e.created_at,
    })).filter((e) => e.url);
  }

  return (
    <AlbumManager
      groupId={groupId}
      pets={pets.map((p) => ({ id: p.id, name: p.name, archived: p.archived }))}
      collectionsByPet={collectionsByPet}
      entriesByPet={entriesByPet}
      canEdit={webdb.canCheckin(access)}
      canDelete={webdb.canManage(access)}
    />
  );
}
