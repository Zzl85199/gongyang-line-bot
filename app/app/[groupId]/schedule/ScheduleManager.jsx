'use client';
// app/app/[groupId]/schedule/ScheduleManager.jsx
// 排程管理表：列出所有提醒（寵物/類型/名稱/時間/劑量），可新增、改時間或劑量、刪除。
// 全部走 /api/app/action；改完用 router.refresh() 重新讀資料。
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const KINDS = [
  { v: 'med', label: '用藥 💊' },
  { v: 'feed', label: '餵食 🍚' },
  { v: 'walk', label: '散步 🦮' },
  { v: 'custom', label: '自訂 ⏰' },
];
const KIND_EMOJI = { med: '💊', feed: '🍚', walk: '🦮', custom: '⏰' };

const C = {
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 16, marginBottom: 14 },
  sub: { color: '#6b7280', fontSize: 13 },
  input: { boxSizing: 'border-box', padding: '8px 10px', borderRadius: 9, border: '1px solid #e5e7eb', fontSize: 14, width: '100%' },
  btn: { padding: '8px 13px', borderRadius: 9, border: 'none', background: '#2f7d5b', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  ghost: { padding: '6px 10px', borderRadius: 9, background: '#fff', color: '#2f7d5b', border: '1px solid #2f7d5b', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  danger: { padding: '6px 10px', borderRadius: 9, background: '#fff', color: '#c0463b', border: '1px solid #c0463b', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  row: { padding: '10px 0', borderTop: '1px solid #f1f2f4' },
};

async function action(body) {
  const r = await fetch('/api/app/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

function EditRow({ groupId, task, onDone, canManage }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [times, setTimes] = useState((task.times || []).join(', '));
  const [dosage, setDosage] = useState(task.dosage || '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const j = await action({ groupId, kind: 'task.update', taskId: task.id, times, dosage });
    setBusy(false);
    if (j.ok) { setEditing(false); router.refresh(); } else alert(errMsg(j.error));
  }
  async function del() {
    if (!confirm(`確定刪除「${task.name}」這個提醒？`)) return;
    setBusy(true);
    const j = await action({ groupId, kind: 'task.delete', taskId: task.id });
    setBusy(false);
    if (j.ok) router.refresh(); else alert(errMsg(j.error));
  }

  return (
    <div style={C.row}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <span style={{ marginRight: 6 }}>{KIND_EMOJI[task.kind] || '⏰'}</span>
          <b>{task.petName}</b> · {task.name}
          {!editing && <div style={{ ...C.sub, marginTop: 4 }}>時間：{(task.times || []).join('、') || '—'}{task.dosage ? `　劑量：${task.dosage}` : ''}</div>}
        </div>
        {canManage && !editing && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={C.ghost} onClick={() => setEditing(true)}>編輯</button>
            <button style={C.danger} onClick={del} disabled={busy}>刪除</button>
          </div>
        )}
      </div>
      {editing && (
        <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
          <div>
            <label style={C.sub}>時間（多個用逗號分隔，例：08:00, 20:00）</label>
            <input style={C.input} value={times} onChange={(e) => setTimes(e.target.value)} />
          </div>
          <div>
            <label style={C.sub}>劑量 / 備註（選填，例：半顆）</label>
            <input style={C.input} value={dosage} onChange={(e) => setDosage(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={C.btn} onClick={save} disabled={busy}>儲存</button>
            <button style={C.ghost} onClick={() => setEditing(false)}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
}

function errMsg(e) {
  const m = {
    no_times: '時間格式看不懂，請用像 08:00, 20:00 的格式。',
    forbidden: '你沒有修改排程的權限。',
    pet_not_found: '找不到這隻毛孩。',
    task_not_found: '這個提醒已經不存在了。',
    server: '伺服器忙不過來，稍後再試。',
  };
  return m[e] || ('操作失敗：' + e);
}

export default function ScheduleManager({ groupId, pets, tasks, canManage }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [petId, setPetId] = useState(pets[0]?.id || '');
  const [taskKind, setTaskKind] = useState('med');
  const [name, setName] = useState('');
  const [times, setTimes] = useState('');
  const [dosage, setDosage] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    const j = await action({ groupId, kind: 'task.create', petId, taskKind, name, times, dosage });
    setBusy(false);
    if (j.ok) {
      setName(''); setTimes(''); setDosage(''); setAdding(false);
      router.refresh();
    } else alert(errMsg(j.error));
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0 14px' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>排程管理</h1>
          <p style={C.sub}>機器人會依這張表，到點在 LINE 群裡提醒</p>
        </div>
        {canManage && <button style={C.btn} onClick={() => setAdding((v) => !v)}>{adding ? '收起' : '＋ 新增提醒'}</button>}
      </div>

      {canManage && adding && (
        <div style={C.card}>
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <select style={{ ...C.input, flex: 1 }} value={petId} onChange={(e) => setPetId(e.target.value)}>
                {pets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select style={{ ...C.input, flex: 1 }} value={taskKind} onChange={(e) => setTaskKind(e.target.value)}>
                {KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}
              </select>
            </div>
            <input style={C.input} placeholder="名稱（例：腎臟藥 / 早餐）" value={name} onChange={(e) => setName(e.target.value)} />
            <input style={C.input} placeholder="時間（例：08:00, 20:00）" value={times} onChange={(e) => setTimes(e.target.value)} />
            <input style={C.input} placeholder="劑量 / 備註（選填，例：半顆）" value={dosage} onChange={(e) => setDosage(e.target.value)} />
            <button style={C.btn} onClick={add} disabled={busy || !petId}>新增</button>
          </div>
        </div>
      )}

      {pets.filter((p) => p.archived).length > 0 && (
        <p style={C.sub}>（紀念模式的毛孩不會再提醒，已從這裡隱藏）</p>
      )}

      <div style={C.card}>
        {tasks.length === 0 ? (
          <span style={C.sub}>還沒有任何提醒。{canManage ? '用上面的「新增提醒」開始吧 🐾' : ''}</span>
        ) : (
          tasks.map((t) => <EditRow key={t.id} groupId={groupId} task={t} canManage={canManage} />)
        )}
      </div>
    </div>
  );
}
