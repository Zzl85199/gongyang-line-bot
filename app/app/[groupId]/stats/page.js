// app/app/[groupId]/stats/page.js
// 達成率視圖：本週每個提醒「應完成 / 實際完成」與達成率，加上散步次數（本週 / 本月）。
import * as db from '../../../../lib/db.js';
import { dateKeyTaipei, weekdayTaipei } from '../../../../lib/time.js';
import { colors } from '../../ui.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const card = { background: '#fff', border: `1px solid ${colors.line}`, borderRadius: 14, padding: 16, marginBottom: 14 };
const sub = { color: colors.sub, fontSize: 13 };

function taipeiMidnightIso(dateKey) {
  return new Date(`${dateKey}T00:00:00+08:00`).toISOString();
}
function addDays(dateKey, n) {
  const d = new Date(`${dateKey}T00:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + n);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const g = Object.fromEntries(p.map((x) => [x.type, x.value]));
  return `${g.year}-${g.month}-${g.day}`;
}

function Bar({ pct }) {
  const color = pct >= 90 ? '#2f7d5b' : pct >= 60 ? '#b8860b' : '#c0463b';
  return (
    <div style={{ background: '#f1f2f4', borderRadius: 999, height: 8, overflow: 'hidden', minWidth: 90, flex: 1 }}>
      <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: color }} />
    </div>
  );
}

export default async function StatsPage({ params }) {
  const groupId = decodeURIComponent(params.groupId);

  const todayKey = dateKeyTaipei();
  const wd = weekdayTaipei(); // 0=Sun..6=Sat
  const daysElapsed = wd === 0 ? 7 : wd; // 週一到今天（含）共幾天
  const weekStartKey = addDays(todayKey, -(daysElapsed - 1));
  const monthStartKey = todayKey.slice(0, 7) + '-01';
  const nowIso = new Date().toISOString();
  const weekStartIso = taipeiMidnightIso(weekStartKey);
  const monthStartIso = taipeiMidnightIso(monthStartKey);

  const pets = await db.listPets(groupId);
  const tasks = await db.listTasksByGroup(groupId);
  const weekLogs = await db.logsBetween(groupId, weekStartIso, nowIso);
  // 統計每個 task 本週的打卡次數
  const doneCount = {};
  for (const l of weekLogs) doneCount[l.task_id] = (doneCount[l.task_id] || 0) + 1;

  const blocks = [];
  for (const pet of pets) {
    const petTasks = tasks.filter((t) => t.pet_id === pet.id);
    const rows = petTasks.map((t) => {
      const slots = (t.times || []).length;
      const expected = slots * daysElapsed;
      const done = doneCount[t.id] || 0;
      const pct = expected ? Math.round((done / expected) * 100) : 0;
      return { name: t.name, emoji: t.emoji || '⏰', expected, done, pct };
    });
    const walkWeek = await db.countWalksBetween(pet.id, weekStartIso, nowIso);
    const walkMonth = await db.countWalksBetween(pet.id, monthStartIso, nowIso);
    blocks.push({ pet, rows, walkWeek, walkMonth });
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '12px 0 4px' }}>達成率</h1>
      <p style={{ ...sub, marginBottom: 14 }}>本週（{weekStartKey} 起，共 {daysElapsed} 天）每個提醒做了沒，以及散步次數。</p>

      {pets.length === 0 && <div style={card}><span style={sub}>還沒有毛孩 🐾</span></div>}

      {blocks.map(({ pet, rows, walkWeek, walkMonth }) => (
        <div key={pet.id} style={card}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px' }}>{pet.name}</h2>
          {rows.length === 0 ? (
            <span style={sub}>沒有排定的提醒。</span>
          ) : (
            rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
                <span style={{ width: 130, fontWeight: 600 }}>{r.emoji} {r.name}</span>
                <Bar pct={r.pct} />
                <span style={{ ...sub, width: 96, textAlign: 'right' }}>{r.done}/{r.expected} 次・{r.pct}%</span>
              </div>
            ))
          )}
          <div style={{ borderTop: `1px solid ${colors.line}`, marginTop: 10, paddingTop: 10, ...sub }}>
            🦮 散步：本週 <b style={{ color: colors.ink }}>{walkWeek}</b> 次・本月 <b style={{ color: colors.ink }}>{walkMonth}</b> 次
          </div>
        </div>
      ))}
    </div>
  );
}
