// lib/perms.js
// 角色權限：刻意做成「選用」。預設 roles_enabled = false → 開放模式，誰都能操作（跟舊行為一致）。
// 有人用「我是主飼主」啟用後，才開始按角色把關。
//
// 三個動作層級（由低到高）：
//   view    查詢類（今天/清單/圖鑑/回顧/健康/交接）—— 人人可
//   checkin 打卡、傳照片、記健康、晚點提醒 —— 照顧者以上
//   manage  改排程、刪除、輪值、安寧/紀念、設角色 —— 主飼主
//
// 角色：owner 主飼主 / caregiver 照顧者 / viewer 唯讀

export const ROLE_LABEL = { owner: '主飼主', caregiver: '照顧者', viewer: '唯讀' };

// 使用者輸入的中文 → 內部角色
export const LABEL_ROLE = {
  主飼主: 'owner', 飼主: 'owner', 管理: 'owner', owner: 'owner',
  照顧者: 'caregiver', 照護者: 'caregiver', 幫手: 'caregiver', caregiver: 'caregiver',
  唯讀: 'viewer', 只能看: 'viewer', 旁觀: 'viewer', viewer: 'viewer',
};

const LEVEL = { viewer: 0, caregiver: 1, owner: 2 };
const NEED = { view: 0, checkin: 1, manage: 2 };

// 取某成員在這個圈的有效角色。
// 開放模式（未啟用角色）→ 一律當 owner（人人全權）。
// 啟用後，沒紀錄到的成員預設 caregiver（家人通常都能幫忙打卡，但改排程要主飼主）。
export function roleOf(group, member) {
  if (!group?.roles_enabled) return 'owner';
  return member?.role || 'caregiver';
}

export function can(group, member, need) {
  return LEVEL[roleOf(group, member)] >= NEED[need];
}

export function parseRole(label) {
  return LABEL_ROLE[String(label || '').trim()] || null;
}
