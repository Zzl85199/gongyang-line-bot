// app/app/[groupId]/members/page.js
import { redirect } from 'next/navigation';
import { getSessionUser } from '../../../../lib/session.js';
import * as webdb from '../../../../lib/webdb.js';
import * as db from '../../../../lib/db.js';
import { baseUrl } from '../../../../lib/album.js';
import AccessManager from './AccessManager.jsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function MembersPage({ params }) {
  const groupId = decodeURIComponent(params.groupId);
  const user = await getSessionUser();
  const access = await webdb.effectiveAccess(groupId, user);
  if (!webdb.canManage(access)) redirect(`/app/${groupId}`); // 只有主飼主能管授權

  const group = await db.getOrCreateGroup(groupId);
  const members = await db.listMembers(groupId);
  const grants = await webdb.listGrants(groupId);
  const base = baseUrl() || '';

  return (
    <AccessManager
      groupId={groupId}
      rolesEnabled={Boolean(group?.roles_enabled)}
      members={members.map((m) => ({ user_id: m.user_id, display_name: m.display_name, role: m.role }))}
      grants={grants.map((g) => ({ id: g.id, email: g.email, role: g.role, token: g.token, redeemed_at: g.redeemed_at }))}
      baseUrl={base}
    />
  );
}
