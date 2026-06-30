'use client';
// app/app/[groupId]/walks/WalksManager.jsx
// 散步日誌：記地點 / 心情 / 時間，可增刪改查。盡量簡單。
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const MOODS = ['😄 開心', '😌 放鬆', '😐 普通', '😟 沒精神', '🌧️ 下雨'];
const C = {
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 16, marginBottom: 14 },
  sub: { color: '#6b7280', fontSize: 13 },
  input: { boxSizing: 'border-box', padding: '8px 10px', borderRadius: 9, border: '1px solid #e5e7eb', fontSize: 14, width: '100%' },
  btn: { padding: '8px 13px', borderRadius: 9, border: 'none', background: '#2f7d5b', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  ghost: { padding: '6px 10px', borderRadius: 9, background: '#fff', color: '#2f7d5b', border: '1px solid #2f7d5b', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  danger: { padding: '6px 10px', borderRadius: 9, background: '#fff', color: '#c0463b', border: '1px solid #c0463b', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  row: { padding: '10px 0', borderTop: '1px solid #f1f2f4' },
  tab: (on) => ({ padding: '6px 12px', borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: 'pointer', border: '1px solid ' + (on ? '#2f7d5b' : '#e5e7eb'), background: on ? '#e8f3ed' : '#fff', color: on ? '#2f7d5b' : '#6b7280' }),
};
async function action(body) {
  const r = await fetch('/api/app/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
function fmtDateTime(iso) {
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}
// datetime-local 需要本地時間字串
function toLocalInput(iso) {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const g = Object.fromEntries(p.map((x) => [x.type, x.value]));
  return `${g.year}-${g.month}-${g.day}T${g.hour}:${g.minute}`;
}
function localInputToIso(v) {
  if (!v) return null;
  return new Date(`${v}:00+08:00`).toISOString();
}

export default function WalksManager({ groupId, pets, walksByPet, canEdit }) {
  const router = useRouter();
  const [petId, setPetId] = useState(pets[0]?.id || null);
  const [place, setPlace] = useState('');
  const [mood, setMood] = useState('');
  const [note, setNote] = useState('');
  const [when, setWhen] = useState('');
  const [editing, setEditing] = useState(null);
  const [ed, setEd] = useState({ place: '', mood: '', note: '', when: '' });
  const [busy, setBusy] = useState(false);

  if (!pets.length) return <div style={C.card}><span style={C.sub}>還沒有毛孩 🐾</span></div>;
  const walks = walksByPet[petId] || [];

  async function add() {
    setBusy(true);
    const j = await action({ groupId, kind: 'walk.create', petId, place, mood, note, walkedAt: localInputToIso(when) });
    setBusy(false);
    if (j.ok) { setPlace(''); setMood(''); setNote(''); setWhen(''); router.refresh(); } else alert('新增失敗：' + j.error);
  }
  async function saveEdit(id) {
    setBusy(true);
    const j = await action({ groupId, kind: 'walk.update', id, place: ed.place, mood: ed.mood, note: ed.note, walkedAt: localInputToIso(ed.when) });
    setBusy(false);
    if (j.ok) { setEditing(null); router.refresh(); } else alert('更新失敗：' + j.error);
  }
  async function del(id) {
    if (!confirm('刪除這筆散步紀錄？')) return;
    const j = await action({ groupId, kind: 'walk.delete', id });
    if (j.ok) router.refresh(); else alert('刪除失敗：' + j.error);
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '12px 0 4px' }}>散步日誌</h1>
      <p style={{ ...C.sub, marginBottom: 12 }}>記下去了哪裡、心情如何。在 LINE 群打「遛 {pets[0]?.name} 河堤 開心」也能記。</p>

      {pets.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          {pets.map((p) => <button key={p.id} style={C.tab(p.id === petId)} onClick={() => setPetId(p.id)}>{p.name}</button>)}
        </div>
      )}

      {canEdit && (
        <div style={C.card}>
          <div style={{ display: 'grid', gap: 8 }}>
            <input style={C.input} placeholder="地點（例：河堤公園）" value={place} onChange={(e) => setPlace(e.target.value)} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {MOODS.map((mo) => <button key={mo} style={C.tab(mood === mo)} onClick={() => setMood(mood === mo ? '' : mo)}>{mo}</button>)}
            </div>
            <input style={C.input} placeholder="備註（選填）" value={note} onChange={(e) => setNote(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input style={C.input} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              <span style={{ ...C.sub, whiteSpace: 'nowrap' }}>不填=現在</span>
            </div>
            <button style={C.btn} onClick={add} disabled={busy}>記一筆散步</button>
          </div>
        </div>
      )}

      <div style={C.card}>
        {walks.length === 0 ? (
          <span style={C.sub}>還沒有散步紀錄。</span>
        ) : (
          walks.map((w) => (
            <div key={w.id} style={C.row}>
              {editing === w.id ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <input style={C.input} value={ed.place} onChange={(e) => setEd({ ...ed, place: e.target.value })} placeholder="地點" />
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {MOODS.map((mo) => <button key={mo} style={C.tab(ed.mood === mo)} onClick={() => setEd({ ...ed, mood: ed.mood === mo ? '' : mo })}>{mo}</button>)}
                  </div>
                  <input style={C.input} value={ed.note} onChange={(e) => setEd({ ...ed, note: e.target.value })} placeholder="備註" />
                  <input style={C.input} type="datetime-local" value={ed.when} onChange={(e) => setEd({ ...ed, when: e.target.value })} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button style={C.btn} onClick={() => saveEdit(w.id)} disabled={busy}>儲存</button>
                    <button style={C.ghost} onClick={() => setEditing(null)}>取消</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div>
                    <span style={C.sub}>{fmtDateTime(w.walked_at)}</span>
                    <span style={{ margin: '0 8px', fontWeight: 600 }}>🦮 {w.place || '散步'}</span>
                    {w.mood && <span>{w.mood}</span>}
                    {w.note && <span style={{ ...C.sub, marginLeft: 8 }}>· {w.note}</span>}
                    {w.by_name && <span style={{ ...C.sub, marginLeft: 8 }}>· {w.by_name}</span>}
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button style={C.ghost} onClick={() => { setEditing(w.id); setEd({ place: w.place || '', mood: w.mood || '', note: w.note || '', when: toLocalInput(w.walked_at) }); }}>編輯</button>
                      <button style={C.danger} onClick={() => del(w.id)}>刪除</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
