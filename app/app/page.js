// app/app/page.js
// 登入後的首頁：列出能看到的照護圈。只有一個就直接進去；都沒有就給說明。
import { redirect } from 'next/navigation';
import { getSessionUser } from '../../lib/session.js';
import * as webdb from '../../lib/webdb.js';
import { page, container, card, h1, h2, sub, btn, colors, roleBadge, ROLE_LABEL } from './ui.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function AppHome() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/app');

  const groups = await webdb.accessibleGroups(user);
  if (groups.length === 1) redirect(`/app/${groups[0].groupId}`);

  return (
    <main style={page}>
      <div style={container}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0 16px' }}>
          <div>
            <h1 style={h1}>嗨，{user.display_name || user.email || '你好'} 🐾</h1>
            <p style={sub}>選一個照護圈進去看看</p>
          </div>
          <a href="/api/auth/logout" style={{ ...sub, color: colors.brand }}>登出</a>
        </div>

        {groups.length === 0 ? (
          <div style={card}>
            <h2 style={h2}>還沒有可看的照護圈</h2>
            <p style={{ ...sub, lineHeight: 1.7 }}>
              如果你是家人：請用「平常加進 LINE 群、會收到提醒的那個 LINE 帳號」登入，就會自動對上你照顧的毛孩。<br />
              如果你是受邀的獸醫／保母：請向對方索取「邀請連結」，點開後就能看到。
            </p>
          </div>
        ) : (
          groups.map((g) => (
            <a key={g.groupId} href={`/app/${g.groupId}`} style={{ ...card, display: 'block', textDecoration: 'none', color: colors.ink }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ ...h2, margin: 0 }}>{g.label}</h2>
                <span style={roleBadge(g.role)}>{ROLE_LABEL[g.role] || g.role}</span>
              </div>
              <p style={{ ...sub, marginTop: 6 }}>
                {g.pets.length ? g.pets.map((p) => `${p.archived ? '🕊️ ' : ''}${p.name}`).join('、') : '尚無毛孩'}
              </p>
            </a>
          ))
        )}
      </div>
    </main>
  );
}
