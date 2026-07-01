// app/community/page.js
// 社群首頁：動態／問答／找保母送養合併成一頁動態牆，上面用篩選 chip 切換。
import { redirect } from 'next/navigation';
import { getSessionUser } from '../../lib/session.js';
import * as webdb from '../../lib/webdb.js';
import * as community from '../../lib/community.js';
import CommunityFeed from './CommunityFeed.jsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function CommunityPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/community');

  const [groups, posts] = await Promise.all([
    webdb.accessibleGroups(user),
    community.listPosts({ kind: 'all', limit: 30 }),
  ]);

  const myPublicPets = groups.flatMap((g) => (g.pets || []).filter((p) => p.public).map((p) => ({ id: p.id, name: p.name, groupId: g.groupId })));

  const postIds = posts.map((p) => p.id);
  const [likeCounts, liked] = await Promise.all([
    community.likeCounts(postIds),
    community.likedPostIds(postIds, user.id),
  ]);
  const photoUrls = await Promise.all(posts.map((p) => (p.photo_path ? community.signedCommunityPhotoUrl(p.photo_path) : null)));

  const initialPosts = posts.map((p, i) => ({
    id: p.id,
    petId: p.pet_id,
    petName: p.pets?.name || '毛孩',
    species: p.pets?.species || null,
    kind: p.kind,
    body: p.body,
    photoUrl: photoUrls[i],
    region: p.region,
    duration: p.duration,
    authorName: p.author_name,
    createdAt: p.created_at,
    likeCount: likeCounts[p.id] || 0,
    liked: liked.has(p.id),
  }));

  return <CommunityFeed initialPosts={initialPosts} myPublicPets={myPublicPets} hasAnyPublicPet={myPublicPets.length > 0} />;
}
