// app/api/app/action/route.js
// 網頁後台的「寫入」統一入口。所有變更都走這裡，集中做登入 + 角色把關。
// 前端送 JSON：{ groupId, kind, ... }；回 JSON：{ ok, ... } 或 { ok:false, error }。
import { getSessionUser } from '../../../../lib/session.js';
import * as webdb from '../../../../lib/webdb.js';
import * as db from '../../../../lib/db.js';
import { parseTimes } from '../../../../lib/time.js';
import { randomToken } from '../../../../lib/auth.js';

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

      default:
        return no('unknown_kind');
    }
  } catch (e) {
    console.error('action error', kind, e.message);
    return no('server', 500);
  }
}
