'use client';
// app/app/[groupId]/members/AccessManager.jsx
// 成員與授權：開關「角色把關」、調整 LINE 家人的角色、產生/撤銷給群外人的邀請連結。
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const ROLE_LABEL = { owner: '主飼主', caregiver: '照顧者', viewer: '唯讀', vet: '獸醫' };
const C = {
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 16, marginBottom: 14 },
  sub: { color: '#6b7280', fontSize: 13 },
  h2: { fontSize: 16, fontWeight: 700, margin: '0 0 10px' },
  input: { boxSizing: 'border-box', padding: '8px 10px', borderRadius: 9, border: '1px solid #e5e7eb', fontSize: 14, width: '100%' },
  btn: { padding: '8px 13px', borderRadius: 9, border: 'none', background: '#2f7d5b', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  ghost: { padding: '6px 10px', borderRadius: 9, background: '#fff', color: '#2f7d5b', border: '1px solid #2f7d5b', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  danger: { padding: '6px 10px', borderRadius: 9, background: '#fff', color: '#c0463b', border: '1px solid #c0463b', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: '1px solid #f1f2f4', gap: 8, flexWrap: 'wrap' },
};

async function action(body) {
  const r = await fetch('/api/app/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

export default function AccessManager({ groupId, rolesEnabled, members, grants, baseUrl }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(rolesEnabled);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('vet');
  const [newLink, setNewLink] = useState(null);
  const [busy, setBusy] = useState(false);

  async function toggleRoles() {
    setBusy(true);
    const j = await action({ groupId, kind: 'group.rolesEnabled', enabled: !enabled });
    setBusy(false);
    if (j.ok) { setEnabled(!enabled); router.refresh(); }
  }
  async function setMemberRole(userId, r) {
    const j = await action({ groupId, kind: 'role.set', userId, role: r });
    if (j.ok) router.refresh();
    else alert(j.error === 'last_owner' ? '至少要留一位主飼主喔。' : '改不動：' + j.error);
  }
  async function invite() {
    setBusy(true);
    const j = await action({ groupId, kind: 'grant.create', email, role });
    setBusy(false);
    if (j.ok) { setNewLink(`${baseUrl}/join?token=${j.token}`); setEmail(''); router.refresh(); }
    else alert('產生失敗：' + j.error);
  }
  async function revoke(id) {
    if (!confirm('撤銷這個授權？對方就看不到了。')) return;
    const j = await action({ groupId, kind: 'grant.revoke', grantId: id });
    if (j.ok) router.refresh();
  }
  function copy(text) {
    navigator.clipboard?.writeText(text).then(() => alert('已複製連結')).catch(() => {});
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '12px 0 4px' }}>成員 / 授權</h1>
      <p style={{ ...C.sub, marginBottom: 14 }}>家人預設都是主飼主；群外的人（獸醫、保母）用邀請連結開放，可隨時撤銷。</p>

      <div style={C.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={C.h2}>角色把關</h2>
            <p style={C.sub}>{enabled ? '已啟用：依角色限制改排程/刪除等動作。' : '未啟用（開放模式）：群裡的人都能操作。'}</p>
          </div>
          <button style={enabled ? C.danger : C.btn} onClick={toggleRoles} disabled={busy}>{enabled ? '停用' : '啟用'}</button>
        </div>
      </div>

      <div style={C.card}>
        <h2 style={C.h2}>LINE 家人</h2>
        {members.length === 0 ? (
          <span style={C.sub}>還沒記錄到成員。家人在 LINE 群裡互動過一次，就會出現在這裡。</span>
        ) : (
          members.map((m) => (
            <div key={m.user_id} style={C.row}>
              <span style={{ fontWeight: 600 }}>{m.display_name || '某位家人'}</span>
              {enabled ? (
                <select style={{ ...C.input, width: 130 }} value={m.role || 'caregiver'} onChange={(e) => setMemberRole(m.user_id, e.target.value)}>
                  <option value="owner">主飼主</option>
                  <option value="caregiver">照顧者</option>
                  <option value="viewer">唯讀</option>
                </select>
              ) : (
                <span style={C.sub}>主飼主（開放模式）</span>
              )}
            </div>
          ))
        )}
      </div>

      <div style={C.card}>
        <h2 style={C.h2}>對外授權（獸醫 / 保母）</h2>
        <div style={{ display: 'grid', gap: 8, marginBottom: 8 }}>
          <input style={C.input} placeholder="對方 Email（選填，方便辨識）" value={email} onChange={(e) => setEmail(e.target.value)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <select style={{ ...C.input, flex: 1 }} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="vet">獸醫（唯讀）</option>
              <option value="viewer">唯讀</option>
              <option value="caregiver">照顧者（可打卡）</option>
            </select>
            <button style={C.btn} onClick={invite} disabled={busy}>產生邀請連結</button>
          </div>
        </div>
        {newLink && (
          <div style={{ background: '#f6f7f9', borderRadius: 9, padding: 10, marginBottom: 8 }}>
            <div style={{ ...C.sub, marginBottom: 6 }}>把這條連結傳給對方，他登入後就能看到：</div>
            <div style={{ wordBreak: 'break-all', fontSize: 13 }}>{newLink}</div>
            <button style={{ ...C.ghost, marginTop: 8 }} onClick={() => copy(newLink)}>複製連結</button>
          </div>
        )}
        {grants.length === 0 ? (
          <span style={C.sub}>目前沒有對外授權。</span>
        ) : (
          grants.map((g) => (
            <div key={g.id} style={C.row}>
              <div>
                <span style={{ fontWeight: 600 }}>{g.email || '（未填 Email）'}</span>
                <span style={{ ...C.sub, marginLeft: 8 }}>{ROLE_LABEL[g.role] || g.role}・{g.redeemed_at ? '已啟用' : '待對方點開'}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {!g.redeemed_at && <button style={C.ghost} onClick={() => copy(`${baseUrl}/join?token=${g.token}`)}>複製連結</button>}
                <button style={C.danger} onClick={() => revoke(g.id)}>撤銷</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
