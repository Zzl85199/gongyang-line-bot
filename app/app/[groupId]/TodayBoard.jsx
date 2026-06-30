'use client';
// app/app/[groupId]/TodayBoard.jsx
// 今日打卡看板：每個時段一顆按鈕，點一下完成 / 再點取消。讀寫都走 /api/app/action。
import { useState } from 'react';

const C = {
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 16, marginBottom: 14 },
  sub: { color: '#6b7280', fontSize: 13 },
  pet: { fontSize: 16, fontWeight: 700, marginBottom: 10 },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid #f1f2f4' },
  done: { background: '#e8f3ed', color: '#2f7d5b', border: '1px solid #2f7d5b' },
  todo: { background: '#fff', color: '#6b7280', border: '1px solid #e5e7eb' },
  pill: { padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
};

export default function TodayBoard({ groupId, initialPets, canCheckin }) {
  const [pets, setPets] = useState(initialPets);
  const [busy, setBusy] = useState(null);

  async function toggle(petIdx, taskIdx, slotIdx) {
    if (!canCheckin) return;
    const slot = pets[petIdx].tasks[taskIdx].slots[slotIdx];
    const key = `${petIdx}-${taskIdx}-${slotIdx}`;
    setBusy(key);
    const task = pets[petIdx].tasks[taskIdx];
    const kind = slot.done ? 'checkin.undo' : 'checkin.done';
    try {
      const r = await fetch('/api/app/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, kind, taskId: task.id, slot: slot.time }),
      });
      const j = await r.json();
      if (j.ok) {
        const copy = structuredClone(pets);
        copy[petIdx].tasks[taskIdx].slots[slotIdx].done = !slot.done;
        setPets(copy);
      }
    } catch {
      /* 靜默失敗，使用者可再點一次 */
    }
    setBusy(null);
  }

  if (!pets.length) return <div style={C.card}><span style={C.sub}>這個照護圈還沒有毛孩。到 LINE 群裡用「新增寵物 名字」開始吧 🐾</span></div>;

  return (
    <>
      {pets.map((pet, pi) => (
        <div key={pet.id} style={C.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={C.pet}>{pet.archived ? '🕊️ ' : ''}{pet.name}</div>
            {pet.albumUrl && (
              <a href={pet.albumUrl} target="_blank" rel="noreferrer" style={{ ...C.sub, color: '#2f7d5b' }}>生命之書 →</a>
            )}
          </div>
          {pet.tasks.length === 0 ? (
            <span style={C.sub}>今天沒有排定的提醒。</span>
          ) : (
            pet.tasks.map((task, ti) => (
              <div key={task.id}>
                {task.slots.map((slot, si) => {
                  const key = `${pi}-${ti}-${si}`;
                  return (
                    <div key={si} style={C.row}>
                      <div>
                        <span style={{ marginRight: 8 }}>{task.emoji || '⏰'}</span>
                        <span style={{ fontWeight: 600 }}>{task.name}</span>
                        <span style={{ ...C.sub, marginLeft: 8 }}>{slot.time}{task.dosage ? `・${task.dosage}` : ''}</span>
                        {slot.done && slot.byName && <span style={{ ...C.sub, marginLeft: 8 }}>· {slot.byName}</span>}
                      </div>
                      <button
                        onClick={() => toggle(pi, ti, si)}
                        disabled={!canCheckin || busy === key}
                        style={{ ...C.pill, ...(slot.done ? C.done : C.todo), opacity: busy === key ? 0.5 : 1, cursor: canCheckin ? 'pointer' : 'default' }}
                      >
                        {slot.done ? '已完成 ✓' : '完成'}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      ))}
      {!canCheckin && <p style={C.sub}>你目前是唯讀身分，看得到進度但不能打卡。</p>}
    </>
  );
}
