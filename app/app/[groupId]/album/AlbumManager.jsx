'use client';
// app/app/[groupId]/album/AlbumManager.jsx
// 生命之書 / 圖鑑相簿牆：依圖鑑分類瀏覽照片，可改說明、改分類、刪除，並可一鍵把回顧推到 LINE 群。
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const C = {
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 16, marginBottom: 14 },
  sub: { color: '#6b7280', fontSize: 13 },
  input: { boxSizing: 'border-box', padding: '7px 9px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, width: '100%' },
  btn: { padding: '8px 13px', borderRadius: 9, border: 'none', background: '#2f7d5b', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  ghost: { padding: '5px 9px', borderRadius: 8, background: '#fff', color: '#2f7d5b', border: '1px solid #2f7d5b', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  danger: { padding: '5px 9px', borderRadius: 8, background: '#fff', color: '#c0463b', border: '1px solid #c0463b', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  chip: (on) => ({ padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1px solid ' + (on ? '#2f7d5b' : '#e5e7eb'), background: on ? '#e8f3ed' : '#fff', color: on ? '#2f7d5b' : '#6b7280' }),
};
async function action(body) {
  const r = await fetch('/api/app/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
function fmt(iso) {
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' }).format(new Date(iso));
}

export default function AlbumManager({ groupId, pets, collectionsByPet, entriesByPet, canEdit, canDelete }) {
  const router = useRouter();
  const [petId, setPetId] = useState(pets[0]?.id || null);
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const [cap, setCap] = useState('');
  const [busy, setBusy] = useState(false);

  if (!pets.length) return <div style={C.card}><span style={C.sub}>還沒有毛孩 🐾</span></div>;

  const cols = collectionsByPet[petId] || [];
  const colMeta = Object.fromEntries(cols.map((c) => [c.key, c]));
  const entries = (entriesByPet[petId] || []).filter((e) => filter === 'all' || e.collection_key === filter);

  async function saveCap(id) {
    setBusy(true);
    const j = await action({ groupId, kind: 'lifebook.caption', id, caption: cap });
    setBusy(false);
    if (j.ok) { setEditing(null); router.refresh(); } else alert('更新失敗：' + j.error);
  }
  async function move(id, key) {
    const j = await action({ groupId, kind: 'lifebook.collection', id, key: key || null });
    if (j.ok) router.refresh(); else alert('移動失敗：' + j.error);
  }
  async function del(id) {
    if (!confirm('刪除這張照片？此動作無法復原（會連同圖檔一起刪）。')) return;
    const j = await action({ groupId, kind: 'lifebook.delete', id });
    if (j.ok) router.refresh(); else alert('刪除失敗：' + j.error);
  }
  async function recap(key) {
    setBusy(true);
    const j = await action({ groupId, kind: 'lifebook.recap', petId, key });
    setBusy(false);
    if (j.ok) alert('已把這本圖鑑的回顧推到 LINE 群囉 🎞️');
    else alert(j.error === 'empty' ? '這本圖鑑還沒有照片。' : '推送失敗：' + j.error);
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '12px 0 4px' }}>相簿 / 圖鑑</h1>
      <p style={{ ...C.sub, marginBottom: 12 }}>照片從 LINE 群傳入會自動收進這裡。可改說明、改分類、刪除，或把某本圖鑑的回顧推回群組。</p>

      {pets.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {pets.map((p) => <button key={p.id} style={C.chip(p.id === petId)} onClick={() => { setPetId(p.id); setFilter('all'); }}>{p.archived ? '🕊️ ' : ''}{p.name}</button>)}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <button style={C.chip(filter === 'all')} onClick={() => setFilter('all')}>全部</button>
        {cols.filter((c) => c.count > 0).map((c) => (
          <button key={c.key} style={C.chip(filter === c.key)} onClick={() => setFilter(c.key)}>{c.emoji} {c.title} {c.count}</button>
        ))}
      </div>

      {filter !== 'all' && canEdit && colMeta[filter]?.kind === 'series' && (
        <div style={{ marginBottom: 14 }}>
          <button style={C.btn} onClick={() => recap(filter)} disabled={busy}>🎞️ 把「{colMeta[filter].title}」回顧推到 LINE 群</button>
        </div>
      )}

      {entries.length === 0 ? (
        <div style={C.card}><span style={C.sub}>這個分類還沒有照片。</span></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
          {entries.map((e) => (
            <div key={e.id} style={{ ...C.card, padding: 8, marginBottom: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={e.url} alt="" style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', borderRadius: 9, background: '#eee' }} />
              <div style={{ ...C.sub, marginTop: 6 }}>{fmt(e.created_at)}{e.by_name ? `・${e.by_name}` : ''}</div>
              {editing === e.id ? (
                <div style={{ marginTop: 6 }}>
                  <input style={C.input} value={cap} onChange={(ev) => setCap(ev.target.value)} placeholder="這一刻的說明" />
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button style={C.ghost} onClick={() => saveCap(e.id)} disabled={busy}>儲存</button>
                    <button style={C.ghost} onClick={() => setEditing(null)}>取消</button>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 13, marginTop: 4, minHeight: 18 }}>{e.caption || <span style={C.sub}>（無說明）</span>}</div>
              )}
              {canEdit && editing !== e.id && (
                <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                  <select style={C.input} value={e.collection_key || ''} onChange={(ev) => move(e.id, ev.target.value)}>
                    <option value="">未分類</option>
                    {cols.map((c) => <option key={c.key} value={c.key}>{c.emoji} {c.title}</option>)}
                  </select>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={C.ghost} onClick={() => { setEditing(e.id); setCap(e.caption || ''); }}>說明</button>
                    {canDelete && <button style={C.danger} onClick={() => del(e.id)}>刪除</button>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {!canEdit && <p style={{ ...C.sub, marginTop: 12 }}>你目前是唯讀身分，看得到照片但不能編輯。</p>}
    </div>
  );
}
