// app/api/app/photo/route.js
// 網頁上傳照片到生命之書（multipart）。檢查登入 + 角色（照顧者以上）。
import { getSessionUser } from '../../../../lib/session.js';
import * as webdb from '../../../../lib/webdb.js';
import * as db from '../../../../lib/db.js';

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
  const groupId = String(form.get('groupId') || '');
  const petId = Number(form.get('petId'));
  const caption = String(form.get('caption') || '').trim() || null;
  const collectionKey = String(form.get('collectionKey') || '') || null;
  const file = form.get('file');

  if (!groupId) return no('missing');
  const access = await webdb.effectiveAccess(groupId, user);
  if (!webdb.canCheckin(access)) return no('forbidden', 403);

  const pet = await db.getPet(petId);
  if (!pet || pet.group_id !== groupId) return no('pet_not_found');
  if (!file || typeof file.arrayBuffer !== 'function') return no('no_file');

  const type = file.type || 'image/jpeg';
  if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) return no('bad_type');
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > 8 * 1024 * 1024) return no('too_big'); // 8MB 上限

  let path = null;
  try {
    path = await db.uploadPhoto(groupId, buf, type);
  } catch (e) {
    console.error('web upload failed', e.message);
  }
  if (!path) return no('upload_failed', 502);

  const entry = await db.addLifebook(pet, { kind: 'memory', photo_path: path, caption, by_name: user.display_name || '網頁' });
  if (entry && collectionKey) await db.setLifebookCollection(entry.id, collectionKey);
  return Response.json({ ok: true });
}
