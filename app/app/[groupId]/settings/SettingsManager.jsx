'use client';
// app/app/[groupId]/settings/SettingsManager.jsx
// 危險區域：主飼主可以刪除整個照護圈（輸入確認文字才能刪，連照片檔案一起永久刪除）；
// 其他角色（照顧者/唯讀/對外授權）只能自己退出，不影響其他人。
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const C = {
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 16, marginBottom: 14 },
  dangerCard: { background: '#fff', border: '1px solid #f3c6c1', borderRadius: 14, padding: 16, marginBottom: 14 },
  sub: { color: '#6b7280', fontSize: 13 },
  h2: { fontSize: 16, fontWeight: 700, margin: '0 0 10px' },
  input: { boxSizing: 'border-box', padding: '8px 10px', borderRadius: 9, border: '1px solid #e5e7eb', fontSize: 14, width: '100%' },
  danger: { padding: '9px 14px', borderRadius: 9, border: 'none', background: '#c0463b', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  dangerDisabled: { padding: '9px 14px', borderRadius: 9, border: 'none', background: '#e9b3ae', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'not-allowed' },
  ghost: { padding: '9px 14px', borderRadius: 9, background: '#fff', color: '#c0463b', border: '1px solid #c0463b', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
};

async function action(body) {
  const r = await fetch('/api/app/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

export default function SettingsManager({ groupId, isManager, confirmPhrase, petsLabel }) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  async function deleteGroup() {
    if (confirmText.trim() !== confirmPhrase) return;
    if (!confirm(`真的要刪除「${petsLabel}」嗎？所有寵物、提醒、健康紀錄、生命之書照片都會永久刪除，無法復原。`)) return;
    setBusy(true);
    const j = await action({ groupId, kind: 'group.delete', confirmText: confirmText.trim() });
    setBusy(false);
    if (j.ok) {
      alert('已刪除這個照護圈。');
      router.push('/app');
    } else {
      alert(j.error === 'confirm_mismatch' ? '確認文字不符，請重新輸入。' : '刪除失敗：' + j.error);
    }
  }

  async function leaveGroup() {
    if (!confirm('確定要退出這個照護圈嗎？其他人不會受影響，之後要再加入需要重新取得邀請。')) return;
    setBusy(true);
    const j = await action({ groupId, kind: 'group.leave' });
    setBusy(false);
    if (j.ok) {
      alert('已退出這個照護圈。');
      router.push('/app');
    } else {
      alert('退出失敗：' + j.error);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '12px 0 4px' }}>設定</h1>
      <p style={{ ...C.sub, marginBottom: 14 }}>{petsLabel}</p>

      {isManager ? (
        <div style={C.dangerCard}>
          <h2 style={{ ...C.h2, color: '#c0463b' }}>⚠️ 刪除照護圈</h2>
          <p style={C.sub}>
            這會永久刪除這個照護圈裡所有的寵物資料、提醒、打卡紀錄、健康紀錄、散步日誌，
            <b>以及生命之書 / 紀念冊裡的所有照片檔案</b>，動作無法復原。
          </p>
          <p style={{ ...C.sub, marginTop: 10 }}>
            請在下方輸入「<b>{confirmPhrase}</b>」以確認：
          </p>
          <input
            style={{ ...C.input, marginTop: 6, marginBottom: 10 }}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={confirmPhrase}
          />
          <button
            style={confirmText.trim() === confirmPhrase && !busy ? C.danger : C.dangerDisabled}
            onClick={deleteGroup}
            disabled={confirmText.trim() !== confirmPhrase || busy}
          >
            永久刪除這個照護圈
          </button>
        </div>
      ) : (
        <div style={C.dangerCard}>
          <h2 style={{ ...C.h2, color: '#c0463b' }}>退出照護圈</h2>
          <p style={C.sub}>你不是主飼主，沒辦法刪除整個照護圈；但可以自己退出，其他人和寵物資料都不會受影響。</p>
          <button style={C.ghost} onClick={leaveGroup} disabled={busy}>退出這個照護圈</button>
        </div>
      )}
    </div>
  );
}
