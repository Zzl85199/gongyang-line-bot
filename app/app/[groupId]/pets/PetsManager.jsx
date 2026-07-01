'use client';
// app/app/[groupId]/pets/PetsManager.jsx
// 毛孩檔案：新增/編輯毛孩（名字/品種/生日/病況）、切換狀態（一般/安寧/紀念）、交接卡顯示設定 + 分享連結、
// 以及照護圈設定（輪值、過時補提醒）。破壞性動作（安寧/紀念）會二次確認。
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const HANDOFF_SECTIONS = [
  ['basic', '基本資料'],
  ['tasks', '每日提醒'],
  ['today', '今天進度'],
  ['weight', '最近體重'],
  ['health', '最近狀況'],
  ['walks', '最近散步'],
  ['contact', '聯絡提醒'],
];
const C = {
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 16, marginBottom: 14 },
  sub: { color: '#6b7280', fontSize: 13 },
  h2: { fontSize: 16, fontWeight: 700, margin: '0 0 10px' },
  input: { boxSizing: 'border-box', padding: '8px 10px', borderRadius: 9, border: '1px solid #e5e7eb', fontSize: 14, width: '100%' },
  btn: { padding: '8px 13px', borderRadius: 9, border: 'none', background: '#2f7d5b', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  ghost: { padding: '6px 10px', borderRadius: 9, background: '#fff', color: '#2f7d5b', border: '1px solid #2f7d5b', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  danger: { padding: '6px 10px', borderRadius: 9, background: '#fff', color: '#c0463b', border: '1px solid #c0463b', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  badge: (bg, fg) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: bg, color: fg }),
};
async function action(body) {
  const r = await fetch('/api/app/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
function stateBadge(p) {
  if (p.archived) return <span style={C.badge('#f3f4f6', '#6b7280')}>紀念中 🕊️</span>;
  if (p.care_state === 'hospice') return <span style={C.badge('#fff4f2', '#c0463b')}>安寧期 🤍</span>;
  return <span style={C.badge('#e8f3ed', '#2f7d5b')}>照護中 🐾</span>;
}

function PetCard({ groupId, pet, handoffUrl }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: pet.name, species: pet.species || '', birthday: pet.birthday || '', health: pet.health || '' });
  const [cfg, setCfg] = useState(pet.handoff_config || Object.fromEntries(HANDOFF_SECTIONS.map(([k]) => [k, true])));
  const [pub, setPub] = useState(Boolean(pet.public));
  const [bio, setBio] = useState(pet.public_bio || '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const j = await action({ groupId, kind: 'pet.update', petId: pet.id, ...f });
    setBusy(false);
    if (j.ok) { setOpen(false); router.refresh(); } else alert('更新失敗：' + j.error);
  }
  async function savePublic(nextPub) {
    setPub(nextPub);
    const j = await action({ groupId, kind: 'pet.public', petId: pet.id, public: nextPub, bio });
    if (!j.ok) { setPub(!nextPub); alert('失敗：' + j.error); }
  }
  async function saveBio() {
    const j = await action({ groupId, kind: 'pet.public', petId: pet.id, public: pub, bio });
    if (j.ok) alert('社群簡介已更新'); else alert('失敗：' + j.error);
  }
  async function setState(state, label) {
    if (!confirm(`確定把 ${pet.name} 切到「${label}」嗎？`)) return;
    const j = await action({ groupId, kind: 'pet.careState', petId: pet.id, state });
    if (j.ok) router.refresh(); else alert('失敗：' + j.error);
  }
  async function archive() {
    if (!confirm(`確定為 ${pet.name} 開啟紀念模式？之後不會再傳牠的提醒，但回憶都會保留。`)) return;
    const j = await action({ groupId, kind: 'pet.archive', petId: pet.id });
    if (j.ok) router.refresh(); else alert('失敗：' + j.error);
  }
  async function restore() {
    const j = await action({ groupId, kind: 'pet.restore', petId: pet.id });
    if (j.ok) router.refresh(); else alert('失敗：' + j.error);
  }
  async function saveCfg() {
    setBusy(true);
    const j = await action({ groupId, kind: 'pet.handoffConfig', petId: pet.id, config: cfg });
    setBusy(false);
    if (j.ok) alert('交接卡設定已儲存'); else alert('失敗：' + j.error);
  }

  return (
    <div style={C.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <span style={{ fontSize: 17, fontWeight: 700, marginRight: 8 }}>{pet.name}</span>
          {stateBadge(pet)}
          {pub && <span style={{ ...C.badge('#eef2ff', '#4338ca'), marginLeft: 6 }}>已公開到社群</span>}
          <div style={{ ...C.sub, marginTop: 4 }}>
            {[pet.species || '毛孩', pet.birthday ? `生日 ${pet.birthday}` : null, pet.health ? `狀況：${pet.health}` : null].filter(Boolean).join('・')}
          </div>
        </div>
        <button style={C.ghost} onClick={() => setOpen((v) => !v)}>{open ? '收起' : '編輯'}</button>
      </div>

      {open && (
        <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gap: 8 }}>
            <input style={C.input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="名字" />
            <input style={C.input} value={f.species} onChange={(e) => setF({ ...f, species: e.target.value })} placeholder="品種（例：米克斯犬）" />
            <div>
              <label style={C.sub}>生日（用於自動調整活動強度）</label>
              <input style={C.input} type="date" value={f.birthday} onChange={(e) => setF({ ...f, birthday: e.target.value })} />
            </div>
            <input style={C.input} value={f.health} onChange={(e) => setF({ ...f, health: e.target.value })} placeholder="病況（例：腎臟病、關節退化）" />
            <button style={C.btn} onClick={save} disabled={busy}>儲存基本資料</button>
          </div>

          <div style={{ borderTop: '1px solid #f1f2f4', paddingTop: 10 }}>
            <div style={{ ...C.sub, marginBottom: 6 }}>狀態切換（敏感操作，會再確認）</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {pet.archived ? (
                <button style={C.ghost} onClick={restore}>恢復照護</button>
              ) : (
                <>
                  {pet.care_state === 'hospice'
                    ? <button style={C.ghost} onClick={() => setState('', '一般照護')}>結束安寧、回到日常</button>
                    : <button style={C.ghost} onClick={() => setState('hospice', '安寧期')}>進入安寧期</button>}
                  <button style={C.danger} onClick={archive}>開啟紀念模式</button>
                </>
              )}
            </div>
          </div>

          <div style={{ borderTop: '1px solid #f1f2f4', paddingTop: 10 }}>
            <div style={{ ...C.sub, marginBottom: 6 }}>交接卡顯示哪些區塊</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {HANDOFF_SECTIONS.map(([k, label]) => {
                const on = cfg[k] !== false;
                return (
                  <button
                    key={k}
                    onClick={() => setCfg({ ...cfg, [k]: !on })}
                    style={{ ...C.ghost, background: on ? '#e8f3ed' : '#fff', color: on ? '#2f7d5b' : '#9aa0aa', border: '1px solid ' + (on ? '#2f7d5b' : '#e5e7eb') }}
                  >
                    {on ? '✓ ' : ''}{label}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button style={C.btn} onClick={saveCfg} disabled={busy}>儲存交接卡設定</button>
              <a href={handoffUrl} target="_blank" rel="noreferrer" style={C.ghost}>開啟可列印交接卡 →</a>
              <button style={C.ghost} onClick={() => navigator.clipboard?.writeText(handoffUrl).then(() => alert('已複製交接卡連結'))}>複製連結</button>
            </div>
            <div style={{ ...C.sub, marginTop: 6 }}>把連結傳給保母／獸醫即可，不需登入；列印時用瀏覽器「列印 → 存成 PDF」。</div>
          </div>

          <div style={{ borderTop: '1px solid #f1f2f4', paddingTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={pub} onChange={(e) => savePublic(e.target.checked)} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>公開到社群</span>
              </label>
            </div>
            <div style={{ ...C.sub, marginBottom: 8 }}>開啟後，{pet.name} 才能在社群發文，其他飼主也能看到牠的公開主頁（名字/照片/簡介，不含照護圈裡的健康紀錄等私密資料）。</div>
            {pub && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <input style={C.input} placeholder="社群簡介，例：愛睡覺的柴犬，最喜歡河堤散步" value={bio} onChange={(e) => setBio(e.target.value)} />
                <button style={C.ghost} onClick={saveBio}>儲存簡介</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PetsManager({ groupId, pets, group, members = [], handoffUrls }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [n, setN] = useState({ name: '', species: '', birthday: '', health: '' });
  const [duty, setDuty] = useState(group.duty_rotation || []);
  const [dutyPick, setDutyPick] = useState('');
  const [dutyCustom, setDutyCustom] = useState('');
  const [overdue, setOverdue] = useState(group.overdue_minutes || 0);
  const [tz, setTz] = useState(group.timezone || 'Asia/Taipei');
  const [busy, setBusy] = useState(false);

  async function addPet() {
    if (!n.name.trim()) return;
    setBusy(true);
    const j = await action({ groupId, kind: 'pet.create', ...n });
    setBusy(false);
    if (j.ok) { setN({ name: '', species: '', birthday: '', health: '' }); setAdding(false); router.refresh(); } else alert('新增失敗：' + j.error);
  }
  function addDuty(nameRaw) {
    const name = nameRaw.trim();
    if (!name || duty.includes(name)) return;
    setDuty([...duty, name]);
  }
  function removeDuty(name) {
    setDuty(duty.filter((d) => d !== name));
  }
  function moveDuty(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= duty.length) return;
    const copy = duty.slice();
    [copy[i], copy[j]] = [copy[j], copy[i]];
    setDuty(copy);
  }
  async function saveDuty() {
    const j = await action({ groupId, kind: 'group.duty', names: duty.join(',') });
    if (j.ok) alert('輪值名單已更新'); else alert('失敗：' + j.error);
  }
  async function saveOverdue() {
    const j = await action({ groupId, kind: 'group.overdue', minutes: overdue });
    if (j.ok) alert('已更新'); else alert('失敗：' + j.error);
  }
  async function saveTz() {
    const j = await action({ groupId, kind: 'group.timezone', timezone: tz });
    if (j.ok) alert('時區已更新，提醒會依這個時區到點觸發'); else alert('失敗：' + j.error);
  }
  const pickableMembers = members.filter((m) => !duty.includes(m));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0 14px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>毛孩檔案</h1>
        <button style={C.btn} onClick={() => setAdding((v) => !v)}>{adding ? '收起' : '＋ 新增毛孩'}</button>
      </div>

      {adding && (
        <div style={C.card}>
          <div style={{ display: 'grid', gap: 8 }}>
            <input style={C.input} placeholder="名字（必填）" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} />
            <input style={C.input} placeholder="品種（選填）" value={n.species} onChange={(e) => setN({ ...n, species: e.target.value })} />
            <input style={C.input} type="date" value={n.birthday} onChange={(e) => setN({ ...n, birthday: e.target.value })} />
            <input style={C.input} placeholder="病況（選填）" value={n.health} onChange={(e) => setN({ ...n, health: e.target.value })} />
            <button style={C.btn} onClick={addPet} disabled={busy}>新增</button>
          </div>
        </div>
      )}

      {pets.map((p) => <PetCard key={p.id} groupId={groupId} pet={p} handoffUrl={handoffUrls[p.id]} />)}

      <div style={C.card}>
        <h2 style={C.h2}>照護圈設定</h2>
        <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          <label style={C.sub}>時區（提醒會依這個時區到點觸發；毛孩在哪個國家就選哪個）</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <select style={C.input} value={tz} onChange={(e) => setTz(e.target.value)}>
              <option value="Asia/Taipei">台灣 / 香港（Asia/Taipei）</option>
              <option value="Asia/Tokyo">日本（Asia/Tokyo）</option>
              <option value="Asia/Shanghai">中國（Asia/Shanghai）</option>
              <option value="Asia/Singapore">新加坡 / 馬來西亞（Asia/Singapore）</option>
              <option value="America/Los_Angeles">美西（America/Los_Angeles）</option>
              <option value="America/New_York">美東（America/New_York）</option>
              <option value="Europe/London">英國（Europe/London）</option>
              <option value="Australia/Sydney">雪梨（Australia/Sydney）</option>
            </select>
            <button style={C.ghost} onClick={saveTz}>儲存</button>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          <label style={C.sub}>輪值名單（每天輪一位，照排列順序輪）</label>
          {duty.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {duty.map((name, i) => (
                <span key={name} style={{ ...C.badge('#e8f3ed', '#2f7d5b'), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {i + 1}. {name}
                  <button type="button" onClick={() => moveDuty(i, -1)} disabled={i === 0} style={{ border: 'none', background: 'none', color: '#2f7d5b', cursor: i === 0 ? 'default' : 'pointer', opacity: i === 0 ? 0.3 : 1, padding: 0, fontSize: 12 }}>↑</button>
                  <button type="button" onClick={() => moveDuty(i, 1)} disabled={i === duty.length - 1} style={{ border: 'none', background: 'none', color: '#2f7d5b', cursor: i === duty.length - 1 ? 'default' : 'pointer', opacity: i === duty.length - 1 ? 0.3 : 1, padding: 0, fontSize: 12 }}>↓</button>
                  <button type="button" onClick={() => removeDuty(name)} style={{ border: 'none', background: 'none', color: '#c0463b', cursor: 'pointer', padding: 0, fontSize: 12 }}>✕</button>
                </span>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {pickableMembers.length > 0 && (
              <select style={{ ...C.input, width: 'auto', flex: '1 1 160px' }} value={dutyPick} onChange={(e) => { addDuty(e.target.value); setDutyPick(''); }}>
                <option value="">＋ 從成員加入…</option>
                {pickableMembers.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
            <input
              style={{ ...C.input, width: 'auto', flex: '1 1 140px' }}
              placeholder="或輸入其他名字"
              value={dutyCustom}
              onChange={(e) => setDutyCustom(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { addDuty(dutyCustom); setDutyCustom(''); } }}
            />
            <button style={C.ghost} onClick={() => { addDuty(dutyCustom); setDutyCustom(''); }}>加入</button>
          </div>
          <div>
            <button style={C.btn} onClick={saveDuty}>儲存輪值名單</button>
          </div>
          <span style={C.sub}>成員清單是曾在 LINE 群裡說過話或打卡過的人；沒看到的人可以直接用右邊輸入框加。</span>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <label style={C.sub}>過時補提醒（超過幾分鐘沒打卡補提醒一次，0 = 關閉）</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...C.input, width: 120 }} type="number" value={overdue} onChange={(e) => setOverdue(e.target.value)} />
            <button style={C.ghost} onClick={saveOverdue}>儲存</button>
          </div>
        </div>
      </div>
    </div>
  );
}
