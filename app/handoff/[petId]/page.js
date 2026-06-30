// app/handoff/[petId]/page.js
// 可列印、可分享的照護交接卡。用 token 簡單防護（不需登入），顯示哪些區塊由飼主在「毛孩檔案」設定。
import * as db from '../../../lib/db.js';
import { handoffToken } from '../../../lib/album.js';
import { ageYears } from '../../../lib/petstate.js';
import { dateKeyTaipei } from '../../../lib/time.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const KIND_EMOJI = { med: '💊', feed: '🍚', walk: '🦮', custom: '⏰' };

function fmt(iso) {
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' }).format(new Date(iso));
}
function fmtDT(iso) {
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}
function ageText(pet) {
  const y = ageYears(pet);
  if (y == null) return null;
  if (y < 1) return `${Math.round(y * 12)} 個月`;
  return `${Math.floor(y)} 歲`;
}

function Notice({ children }) {
  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, "Noto Sans TC", sans-serif', color: '#444' }}>
      <div>{children}</div>
    </main>
  );
}

export default async function Handoff({ params, searchParams }) {
  const petId = Number(params.petId);
  if (!petId || searchParams?.k !== handoffToken(petId)) return <Notice>連結無效或已過期 🐾</Notice>;

  const pet = await db.getPet(petId);
  if (!pet) return <Notice>找不到這隻毛孩。</Notice>;

  const cfg = pet.handoff_config || {};
  const show = (k) => cfg[k] !== false; // 預設全顯示

  const tasks = await db.listTasks(petId);
  const logs = await db.todayLogs(pet.group_id);
  const doneSet = new Set(logs.filter((l) => l.pet_id === petId).map((l) => `${l.task_id}@${l.scheduled_time}`));
  const todayRows = [];
  for (const t of tasks) for (const slot of (t.times || []).slice().sort()) todayRows.push({ done: doneSet.has(`${t.id}@${slot}`), slot, name: t.name });

  const latestWeight = (await db.weightLogs(petId, 1))[0] || null;
  const recentHealth = (await db.recentHealthLogs(petId, 30)).filter((h) => h.kind === 'symptom' || h.kind === 'note' || h.kind === 'appetite').slice(0, 5);
  const recentWalks = (await db.listWalkLogs(petId, 5));

  const ag = ageText(pet);
  const today = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date());

  const css = `
    * { box-sizing: border-box; }
    body { margin: 0; }
    .wrap { max-width: 640px; margin: 0 auto; padding: 28px 20px 60px; font-family: system-ui, -apple-system, "Noto Sans TC", sans-serif; color: #1f2329; }
    h1 { font-size: 24px; margin: 0 0 2px; }
    .muted { color: #6b7280; font-size: 13px; }
    .sec { border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px 16px; margin-top: 14px; }
    .sec h2 { font-size: 15px; margin: 0 0 8px; }
    .row { padding: 5px 0; border-top: 1px solid #f3f4f6; }
    .row:first-of-type { border-top: none; }
    .pill { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; background:#e8f3ed; color:#2f7d5b; }
    .print { margin-top: 18px; }
    .print button { padding: 9px 16px; border-radius: 10px; border: none; background: #2f7d5b; color: #fff; font-weight: 600; cursor: pointer; }
    @media print { .print { display: none; } .sec { break-inside: avoid; } }
  `;

  return (
    <main>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="wrap">
        <h1>📋 {pet.name} 的照護交接卡</h1>
        <div className="muted">產生於 {today}{pet.archived ? '・紀念中' : pet.care_state === 'hospice' ? '・安寧期' : ''}</div>

        {show('basic') && (
          <div className="sec">
            <h2>🐾 基本資料</h2>
            <div className="row">{[pet.species || '毛孩', ag ? `約 ${ag}` : null].filter(Boolean).join('，')}</div>
            {pet.health && <div className="row">狀況：{pet.health}</div>}
          </div>
        )}

        {show('tasks') && (
          <div className="sec">
            <h2>⏰ 每日提醒</h2>
            {tasks.length === 0 ? <div className="row muted">無</div> : tasks.map((t) => (
              <div className="row" key={t.id}>
                {KIND_EMOJI[t.kind] || '⏰'} {t.name}{t.dosage ? `（${t.dosage}）` : ''}：{(t.times || []).join('、')}
              </div>
            ))}
          </div>
        )}

        {show('today') && (
          <div className="sec">
            <h2>📍 今天進度</h2>
            {todayRows.length === 0 ? <div className="row muted">今天沒有排定的提醒</div> : todayRows.map((r, i) => (
              <div className="row" key={i}>{r.done ? '✅' : '⬜'} {r.slot} {r.name}</div>
            ))}
          </div>
        )}

        {show('weight') && latestWeight && (
          <div className="sec">
            <h2>⚖️ 最近體重</h2>
            <div className="row">{latestWeight.value_num} kg（{fmt(latestWeight.created_at)}）</div>
          </div>
        )}

        {show('health') && recentHealth.length > 0 && (
          <div className="sec">
            <h2>🩺 最近狀況</h2>
            {recentHealth.map((h) => (
              <div className="row" key={h.id}>{fmt(h.created_at)}・{h.value_text || ''}</div>
            ))}
          </div>
        )}

        {show('walks') && recentWalks.length > 0 && (
          <div className="sec">
            <h2>🦮 最近散步</h2>
            {recentWalks.map((w) => (
              <div className="row" key={w.id}>{fmtDT(w.walked_at)}・{w.place || '散步'}{w.mood ? `・${w.mood}` : ''}</div>
            ))}
          </div>
        )}

        {show('contact') && (
          <div className="sec">
            <h2>🙏 提醒</h2>
            <div className="row muted">有任何狀況，請聯絡主飼主。謝謝你幫忙照顧 {pet.name}。</div>
          </div>
        )}

        <div className="print">
          <button type="button">列印 / 存成 PDF</button>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: `document.querySelector('.print button').addEventListener('click', function(){ window.print(); });` }} />
    </main>
  );
}
