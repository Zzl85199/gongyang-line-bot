// app/api/app/community-photo/route.js
// 網頁上傳社群貼文的照片（multipart）。貼文本身用 /api/app/action 的 community.create 先建立，
// 這裡只負責把照片補上去，流程跟生命之書上傳照片一致（先建資料、再補圖）。
import { getSessionUser } from '../../../../lib/session.js';
import * as community from '../../../../lib/community.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const no = (error, status = 400) => Response.json({ ok: false, error }, { status });

export async function POST(req) {
  const user = await getSessionUser();
  if (!user) return no('not_logged_in', 401);

  let form;
  try {
    form = await req.formData();
  } catch {
    return no('bad_form');
  }
  const postId = Number(form.get('postId'));
  const file = form.get('file');
  if (!postId || !file || typeof file.arrayBuffer !== 'function') return no('missing');

  const post = await community.getPost(postId);
  if (!post) return no('not_found');
  const isAuthor = post.author_user_id && String(post.author_user_id) === String(user.id);
  if (!isAuthor) return no('forbidden', 403);

  const type = file.type || 'image/jpeg';
  if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) return no('bad_type');
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > 8 * 1024 * 1024) return no('too_big');

  const path = await community.uploadCommunityPhoto(post.group_id, buf, type);
  if (!path) return no('upload_failed', 502);

  const updated = await community.setPostPhoto(postId, path);
  return Response.json({ ok: true, post: updated });
}
