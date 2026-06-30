// app/api/app/action/route.js
// 網頁後台的「寫入」統一入口。所有變更都走這裡，集中做登入 + 角色把關。
// 前端送 JSON：{ groupId, kind, ... }；回 JSON：{ ok, ... } 或 { ok:false, error }。
import { getSessionUser } from '../../../../lib/session.js';
import * as webdb from '../../../../lib/webdb.js';
import * as db from '../../../../lib/db.js';
import * as line from '../../../../lib/line.js';
import * as msg from '../../../../lib/messages.js';
import { parseTimes } from '../../../../lib/time.js';
import { randomToken } from '../../../../lib/auth.js';
import { albumUrl } from '../../../../lib/album.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ok = (extra = {}) => Response.json({ ok: true, ...extra });
const no = (error, status = 400) => Response.json({ ok: false, error }, { status });

export async function POST(req) {
  const user = await getSessionUser();
  if (!user) return no('not_logged_in', 401);

  let body;
  try {
    body = await req.json();
  } catch {
    return no('bad_json');
  }
  const { groupId, kind } = body || {};
  if (!groupId || !kind) return no('missing');

  const access = await webdb.effectiveAccess(groupId, user);
  if (!access) return no('no_access', 403);

  const needManage = () => webdb.canManage(access);
  const needCheckin = () => webdb.canCheckin(access);

  try {
    switch (kind) {
      // ---------- 排程（任務）----------
      case 'task.create': {
        if (!needManage()) return no('forbidden', 403);
        const pet = await db.getPet(Number(body.petId));
        if (!pet || pet.group_id !== groupId) return no('pet_not_found');
        const times = parseTimes(body.times || '');
        if (!times.length) return no('no_times');
        const t = await db.addTask(pet, {
          kind: body.taskKind || 'custom',
          name: (body.name || '').trim() || undefined,
          times,
          dosage: (body.dosage || '').trim() || null,
        });
        return ok({ task: t });
      }
      case 'task.update': {
        if (!needManage()) return no('forbidden', 403);
        const task = await db.getTask(Number(body.taskId));
        if (!task || task.group_id !== groupId) return no('task_not_found');
        const fields = {};
        if (body.times !== undefined) {
          const times = parseTimes(body.times || '');
          if (!times.length) return no('no_times');
          fields.times = times;
        }
        if (body.dosage !== undefined) fields.dosage = (body.dosage || '').trim() || null;
        const updated = await db.updateTaskFields(task.id, fields);
        return ok({ task: updated });
      }
      case 'task.delete': {
        if (!needManage()) return no('forbidden', 403);
        const task = await db.getTask(Number(body.taskId));
        if (!task || task.group_id !== groupId) return no('task_not_found');
        await db.removeTask(task.id);
        return ok();
      }

      // ---------- 打卡（今日狀態）----------
      case 'checkin.done': {
        if (!needCheckin()) return no('forbidden', 403);
        const task = await db.getTask(Number(body.taskId));
        if (!task || task.group_id !== groupId) return no('task_not_found');
        const name = user.display_name || '網頁';
        const { created } = await db.markDone(task, body.slot, user.line_user_id || null, name);
        if (created && task.kind === 'med' && task.stock_count != null) await db.consumeStock(task);
        return ok({ created });
      }
      case 'checkin.undo': {
        if (!needCheckin()) return no('forbidden', 403);
        const task = await db.getTask(Number(body.taskId));
        if (!task || task.group_id !== groupId) return no('task_not_found');
        const removed = await db.deleteLog(task.id, body.slot);
        if (removed && task.kind === 'med' && task.stock_count != null) await db.restoreStock(task);
        return ok({ removed });
      }

      // ---------- 角色 / 開放模式 ----------
      case 'group.rolesEnabled': {
        if (!needManage()) return no('forbidden', 403);
        await db.setRolesEnabled(groupId, Boolean(body.enabled));
        return ok();
      }
      case 'role.set': {
        if (!needManage()) return no('forbidden', 403);
        const role = ['owner', 'caregiver', 'viewer'].includes(body.role) ? body.role : null;
        if (!role || !body.userId) return no('bad_role');
        // 安全閥：不要把最後一位主飼主降級，免得沒人能管
        if (role !== 'owner') {
          const owners = await db.countOwners(groupId);
          const cur = await db.getMember(groupId, body.userId);
          if (owners <= 1 && cur?.role === 'owner') return no('last_owner');
        }
        await db.setMemberRole(groupId, body.userId, role);
        return ok();
      }

      // ---------- 對外授權（獸醫等）----------
      case 'grant.create': {
        if (!needManage()) return no('forbidden', 403);
        const role = ['caregiver', 'viewer', 'vet'].includes(body.role) ? body.role : 'viewer';
        const token = randomToken(20);
        const g = await webdb.createGrant({
          groupId,
          email: body.email || '',
          role,
          token,
          createdBy: user.display_name || user.email || null,
        });
        return ok({ grant: g, token });
      }
      case 'grant.revoke': {
        if (!needManage()) return no('forbidden', 403);
        await webdb.revokeGrant(Number(body.grantId), groupId);
        return ok();
      }

      // ---------- 健康紀錄（體重/食慾/症狀/備註）----------
      case 'health.create': {
        if (!needCheckin()) return no('forbidden', 403);
        const pet = await db.getPet(Number(body.petId));
        if (!pet || pet.group_id !== groupId) return no('pet_not_found');
        const hk = ['weight', 'appetite', 'symptom', 'note'].includes(body.healthKind) ? body.healthKind : 'note';
        const by = user.display_name || '網頁';
        if (hk === 'weight') {
          const n = parseFloat(body.value);
          if (!(n > 0)) return no('bad_weight');
          await db.addHealthLog(pet, { kind: 'weight', valueNum: n, byName: by });
        } else {
          const txt = (body.value || '').trim();
          if (!txt) return no('empty');
          await db.addHealthLog(pet, { kind: hk, valueText: txt, byName: by });
        }
        return ok();
      }
      case 'health.update': {
        if (!needCheckin()) return no('forbidden', 403);
        const log = await db.getHealthLog(Number(body.id));
        if (!log || log.group_id !== groupId) return no('not_found');
        if (log.kind === 'weight') {
          const n = parseFloat(body.value);
          if (!(n > 0)) return no('bad_weight');
          await db.updateHealthLog(log.id, { valueNum: n });
        } else {
          await db.updateHealthLog(log.id, { valueText: (body.value || '').trim() });
        }
        return ok();
      }
      case 'health.delete': {
        if (!needCheckin()) return no('forbidden', 403);
        const log = await db.getHealthLog(Number(body.id));
        if (!log || log.group_id !== groupId) return no('not_found');
        await db.deleteHealthLog(log.id);
        return ok();
      }

      // ---------- 散步日誌（地點/心情/時間）----------
      case 'walk.create': {
        if (!needCheckin()) return no('forbidden', 403);
        const pet = await db.getPet(Number(body.petId));
        if (!pet || pet.group_id !== groupId) return no('pet_not_found');
        await db.addWalkLog(pet, {
          place: (body.place || '').trim() || null,
          mood: (body.mood || '').trim() || null,
          note: (body.note || '').trim() || null,
          walkedAt: body.walkedAt || null,
          byName: user.display_name || '網頁',
        });
        return ok();
      }
      case 'walk.update': {
        if (!needCheckin()) return no('forbidden', 403);
        const w = await db.getWalkLog(Number(body.id));
        if (!w || w.group_id !== groupId) return no('not_found');
        await db.updateWalkLog(w.id, {
          place: body.place !== undefined ? (body.place || '').trim() || null : undefined,
          mood: body.mood !== undefined ? (body.mood || '').trim() || null : undefined,
          note: body.note !== undefined ? (body.note || '').trim() || null : undefined,
          walkedAt: body.walkedAt || undefined,
        });
        return ok();
      }
      case 'walk.delete': {
        if (!needCheckin()) return no('forbidden', 403);
        const w = await db.getWalkLog(Number(body.id));
        if (!w || w.group_id !== groupId) return no('not_found');
        await db.deleteWalkLog(w.id);
        return ok();
      }

      // ---------- 生命之書 / 圖鑑 ----------
      case 'lifebook.caption': {
        if (!needCheckin()) return no('forbidden', 403);
        const e = await db.getLifebookEntry(Number(body.id));
        if (!e || e.group_id !== groupId) return no('not_found');
        await db.updateLifebookCaption(e.id, (body.caption || '').trim() || null);
        return ok();
      }
      case 'lifebook.collection': {
        if (!needCheckin()) return no('forbidden', 403);
        const e = await db.getLifebookEntry(Number(body.id));
        if (!e || e.group_id !== groupId) return no('not_found');
        await db.setLifebookCollection(e.id, body.key || null);
        return ok();
      }
      case 'lifebook.delete': {
        if (!needManage()) return no('forbidden', 403); // 刪照片較破壞性，限主飼主
        const e = await db.getLifebookEntry(Number(body.id));
        if (!e || e.group_id !== groupId) return no('not_found');
        await db.deleteLifebook(e.id);
        return ok();
      }
      // 觸發回顧：把某圖鑑的回顧卡推到 LINE 群
      case 'lifebook.recap': {
        if (!needCheckin()) return no('forbidden', 403);
        const pet = await db.getPet(Number(body.petId));
        if (!pet || pet.group_id !== groupId) return no('pet_not_found');
        const key = body.key;
        const col = await db.getCollectionMeta(pet.id, key);
        if (!col) return no('no_collection');
        const entries = (await db.lifebookByCollection(pet.id, key, 9)).filter((e) => e.photo_path);
        if (!entries.length) return no('empty');
        const urls = await Promise.all(entries.map((e) => db.signedPhotoUrl(e.photo_path)));
        try {
          await line.push(groupId, msg.collectionRecap(pet, col, entries, urls));
        } catch (e) {
          return no('push_failed', 502);
        }
        return ok();
      }

      // ---------- 寵物檔案 / 狀態 ----------
      case 'pet.create': {
        if (!needManage()) return no('forbidden', 403);
        const name = (body.name || '').trim();
        if (!name) return no('empty');
        const pet = await db.addPet(groupId, name, (body.species || '').trim() || null);
        if (body.birthday || body.health) {
          await db.setPetInfo(pet.id, {
            birthday: body.birthday || undefined,
            health: body.health !== undefined ? (body.health || '').trim() || null : undefined,
          });
        }
        return ok({ pet });
      }
      case 'pet.update': {
        if (!needManage()) return no('forbidden', 403);
        const pet = await db.getPet(Number(body.petId));
        if (!pet || pet.group_id !== groupId) return no('pet_not_found');
        if (body.name !== undefined && body.name.trim()) await db.renamePet(pet.id, body.name.trim());
        await db.setPetInfo(pet.id, {
          species: body.species !== undefined ? (body.species || '').trim() || null : undefined,
          birthday: body.birthday !== undefined ? body.birthday || null : undefined,
          health: body.health !== undefined ? (body.health || '').trim() || null : undefined,
        });
        return ok();
      }
      case 'pet.careState': {
        if (!needManage()) return no('forbidden', 403);
        const pet = await db.getPet(Number(body.petId));
        if (!pet || pet.group_id !== groupId) return no('pet_not_found');
        // state: '' | 'hospice'（安寧）；archived 走 pet.archive / pet.restore
        await db.setCareState(pet.id, body.state === 'hospice' ? 'hospice' : null);
        return ok();
      }
      case 'pet.archive': {
        if (!needManage()) return no('forbidden', 403);
        const pet = await db.getPet(Number(body.petId));
        if (!pet || pet.group_id !== groupId) return no('pet_not_found');
        await db.archivePet(pet.id);
        const g = await db.getOrCreateGroup(groupId);
        if (g.active_pet_id === pet.id) {
          const rest = await db.listPets(groupId);
          await db.setActivePet(groupId, rest[0]?.id || null);
        }
        return ok();
      }
      case 'pet.restore': {
        if (!needManage()) return no('forbidden', 403);
        const pet = await db.getPet(Number(body.petId));
        if (!pet || pet.group_id !== groupId) return no('pet_not_found');
        await db.restorePet(pet.id);
        return ok();
      }
      case 'pet.handoffConfig': {
        if (!needManage()) return no('forbidden', 403);
        const pet = await db.getPet(Number(body.petId));
        if (!pet || pet.group_id !== groupId) return no('pet_not_found');
        await db.setHandoffConfig(pet.id, body.config || null);
        return ok();
      }

      // ---------- 照護圈設定：輪值 / 過時補提醒 ----------
      case 'group.duty': {
        if (!needManage()) return no('forbidden', 403);
        const names = (body.names || '').split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean);
        await db.setDutyRotation(groupId, names);
        return ok();
      }
      case 'group.overdue': {
        if (!needManage()) return no('forbidden', 403);
        const mins = Math.max(0, parseInt(body.minutes, 10) || 0);
        await db.setOverdueMinutes(groupId, mins);
        return ok();
      }

      default:
        return no('unknown_kind');
    }
  } catch (e) {
    console.error('action error', kind, e.message);
    return no('server', 500);
  }
}
