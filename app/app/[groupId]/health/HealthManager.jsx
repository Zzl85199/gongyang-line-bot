'use client';
// app/app/[groupId]/health/HealthManager.jsx
// 健康頁：選一隻毛孩 → 體重折線圖 + 健康時間軸（體重/食慾/症狀/備註），可增刪改查。
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const KIND = { weight: { e: '⚖️', l: '體重' }, appetite: { e: '🍽️', l: '食慾' }, symptom: { e: '🤒', l: '症狀' }, note: { e: '📝', l: '備註' } };
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
function fmt(iso) {
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' }).format(new Date(iso));
}

function WeightChart({ weights }) {
  // weights: 由舊到新 [{ value_num, created_at }]
  if (weights.length < 2) return <p style={C.sub}>累積 2 筆以上體重就會畫出趨勢圖。</p>;
  const W = 600, H = 180, pad = 30;
  const vals = weights.map((w) => w.value_num);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i) => pad + (i * (W - pad * 2)) / (weights.length - 1);
  const y = (v) => H - pad - ((v - min) / span) * (H - pad * 2);
  const pts = weights.map((w, i) => `${x(i)},${y(w.value_num)}`).join(' ');
  const last = weights[weights.length - 1], first = weights[0];
  const diff = Math.round((last.value_num - first.value_num) * 100) / 100;
  return (
    <div>
      <p style={{ ...C.sub, marginBottom: 6 }}>
        體重趨勢：{first.value_num} → <b style={{ color: '#1f2329' }}>{last.value_num} kg</b>（{diff > 0 ? `↑${diff}` : diff < 0 ? `↓${Math.abs(diff)}` : '持平'}）
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
        <polyline points={pts} fill="none" stroke="#2f7d5b" strokeWidth="2.5" strokeLinejoin="round" />
        {weights.map((w, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(w.value_num)} r="3.5" fill="#2f7d5b" />
            {(i === 0 || i === weights.length - 1) && (
              <text x={x(i)} y={y(w.value_num) - 8} fontSize="12" textAnchor="middle" fill="#1f2329">{w.value_num}</text>
            )}
            <text x={x(i)} y={H - 8} fontSize="11" textAnchor="middle" fill="#9aa0aa">{fmt(w.created_at)}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function HealthManager({ groupId, pets, logsByPet, canEdit }) {
  const router = useRouter();
  const [petId, setPetId] = useState(pets[0]?.id || null);
  const [hk, setHk] = useState('weight');
  const [val, setVal] = useState('');
  const [editing, setEditing] = useState(null); // log id
  const [editVal, setEditVal] = useState('');
  const [tlFilter, setTlFilter] = useState('all');
  const [busy, setBusy] = useState(false);

  if (!pets.length) return <div style={C.card}><span style={C.sub}>還沒有毛孩。先到「毛孩檔案」或 LINE 群裡新增一隻 🐾</span></div>;

  const logs = (logsByPet[petId] || []);
  const weightsAsc = logs.filter((l) => l.kind === 'weight').slice().reverse();

  async function add() {
    if (!val.trim()) return;
    setBusy(true);
    const j = await action({ groupId, kind: 'health.create', petId, healthKind: hk, value: val });
    setBusy(false);
    if (j.ok) { setVal(''); router.refresh(); } else alert('新增失敗：' + j.error);
  }
  async function saveEdit(id) {
    setBusy(true);
    const j = await action({ groupId, kind: 'health.update', id, value: editVal });
    setBusy(false);
    if (j.ok) { setEditing(null); router.refresh(); } else alert('更新失敗：' + j.error);
  }
  async function del(id) {
    if (!confirm('刪除這筆紀錄？')) return;
    const j = await action({ groupId, kind: 'health.delete', id });
    if (j.ok) router.refresh(); else alert('刪除失敗：' + j.error);
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '12px 0 4px' }}>健康紀錄</h1>
      <p style={{ ...C.sub, marginBottom: 12 }}>體重趨勢與食慾／症狀／備註的時間軸，獸醫最想看的一頁。</p>

      {pets.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          {pets.map((p) => (
            <button key={p.id} style={C.tab(p.id === petId)} onClick={() => setPetId(p.id)}>{p.archived ? '🕊️ ' : ''}{p.name}</button>
          ))}
        </div>
      )}

      <div style={C.card}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 10px' }}>體重趨勢</h2>
        <WeightChart weights={weightsAsc} />
      </div>

      {canEdit && (
        <div style={C.card}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 10px' }}>新增一筆</h2>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            {Object.entries(KIND).map(([k, v]) => (
              <button key={k} style={C.tab(k === hk)} onClick={() => setHk(k)}>{v.e} {v.l}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              style={C.input}
              type={hk === 'weight' ? 'number' : 'text'}
              step="0.1"
              placeholder={hk === 'weight' ? '公斤，例：5.2' : hk === 'appetite' ? '例：正常 / 不佳 / 沒吃' : hk === 'symptom' ? '例：嘔吐兩次' : '備註'}
              value={val}
              onChange={(e) => setVal(e.target.value)}
            />
            <button style={C.btn} onClick={add} disabled={busy}>記錄</button>
          </div>
        </div>
      )}

      <div style={C.card}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 10px' }}>時間軸</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <button style={C.tab(tlFilter === 'all')} onClick={() => setTlFilter('all')}>全部</button>
          {Object.entries(KIND).map(([k, v]) => (
            <button key={k} style={C.tab(tlFilter === k)} onClick={() => setTlFilter(k)}>{v.e} {v.l}</button>
          ))}
        </div>
        {(() => {
          const shown = logs.filter((l) => tlFilter === 'all' || l.kind === tlFilter);
          if (shown.length === 0) return <span style={C.sub}>{tlFilter === 'all' ? '還沒有任何紀錄。' : '這個分類還沒有紀錄。'}</span>;
          return shown.map((l) => {
            const meta = KIND[l.kind] || KIND.note;
            const display = l.kind === 'weight' ? `${l.value_num} kg` : l.value_text || '';
            return (
              <div key={l.id} style={C.row}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div>
                    <span style={C.sub}>{fmt(l.created_at)}</span>
                    <span style={{ margin: '0 6px' }}>{meta.e}</span>
                    {editing === l.id ? (
                      <input style={{ ...C.input, width: 160, display: 'inline-block' }} value={editVal} onChange={(e) => setEditVal(e.target.value)} />
                    ) : (
                      <b>{display}</b>
                    )}
                    {l.by_name && editing !== l.id && <span style={{ ...C.sub, marginLeft: 8 }}>· {l.by_name}</span>}
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      {editing === l.id ? (
                        <>
                          <button style={C.btn} onClick={() => saveEdit(l.id)} disabled={busy}>儲存</button>
                          <button style={C.ghost} onClick={() => setEditing(null)}>取消</button>
                        </>
                      ) : (
                        <>
                          <button style={C.ghost} onClick={() => { setEditing(l.id); setEditVal(l.kind === 'weight' ? String(l.value_num) : l.value_text || ''); }}>編輯</button>
                          <button style={C.danger} onClick={() => del(l.id)}>刪除</button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          });
        })()}
      </div>
      {!canEdit && <p style={C.sub}>你目前是唯讀身分，看得到紀錄但不能編輯。</p>}
    </div>
  );
}
