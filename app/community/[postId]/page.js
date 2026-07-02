// app/community/[postId]/page.js
// 貼文詳情頁：完整內容 + 讚 + 留言，找保母/送養的地區期間放在最顯眼位置。
import { redirect, notFound } from 'next/navigation';
import { getSessionUser } from '../../../lib/session.js';
import * as community from '../../../lib/community.js';
import CommunityPostDetail from './CommunityPostDetail.jsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function CommunityPostPage({ params }) {
  const postId = Number(params.postId);
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=/community/${postId}`);

  const post = await community.getPost(postId);
  if (!post || !post.pets?.public) notFound();

  const [comments, photoUrl, likeCounts, liked] = await Promise.all([
    community.listComments(postId),
    post.photo_path ? community.signedCommunityPhotoUrl(post.photo_path) : null,
    community.likeCounts([postId]),
    community.likedPostIds([postId], user.id),
  ]);

  const initialPost = {
    id: post.id,
    groupId: post.group_id,
    petId: post.pet_id,
    petName: post.pets?.name || '毛孩',
    species: post.pets?.species || null,
    kind: post.kind,
    body: post.body,
    photoUrl,
    region: post.region,
    duration: post.duration,
    authorName: post.author_name,
    authorUserId: post.author_user_id,
    createdAt: post.created_at,
    likeCount: likeCounts[postId] || 0,
    liked: liked.has(postId),
  };
  const initialComments = comments.map((c) => ({ id: c.id, body: c.body, authorName: c.author_name, authorUserId: c.author_user_id, createdAt: c.created_at }));

  return <CommunityPostDetail initialPost={initialPost} initialComments={initialComments} myUserId={user.id} />;
}
