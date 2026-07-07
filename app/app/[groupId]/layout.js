// app/app/[groupId]/layout.js
// 照護圈內頁的外框：擋掉沒權限的人，並畫出頂部導覽。每個子頁會自己再讀一次資料。
import { redirect } from 'next/navigation';
import { getSessionUser } from '../../../lib/session.js';
import * as webdb from '../../../lib/webdb.js';
import * as db from '../../../lib/db.js';
import { page, container, colors, roleBadge, ROLE_LABEL, sub } from '../ui.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function GroupLayout({ children, params }) {
  const groupId = decodeURIComponent(params.groupId);
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/app/${groupId}`)}`);

  const access = await webdb.effectiveAccess(groupId, user);
  if (!access) redirect('/app');

  const pets = await db.listAllPets(groupId);
  const label = webdb.petsLabel(pets);
  const isManager = webdb.canManage(access);

  const tabs = [
    { href: `/app/${groupId}`, label: '今天' },
    { href: `/app/${groupId}/schedule`, label: '排程' },
    { href: `/app/${groupId}/health`, label: '健康' },
    { href: `/app/${groupId}/walks`, label: '散步' },
    { href: `/app/${groupId}/album`, label: '相簿' },
    { href: `/app/${groupId}/stats`, label: '統計' },
  ];
  if (isManager) tabs.push({ href: `/app/${groupId}/pets`, label: '毛孩檔案' });
  if (isManager) tabs.push({ href: `/app/${groupId}/members`, label: '成員 / 授權' });
  tabs.push({ href: `/app/${groupId}/settings`, label: '設定' });

  return (
    <main style={page}>
      <header style={{ background: '#fff', borderBottom: `1px solid ${colors.line}`, position: 'sticky', top: 0, zIndex: 5 }}>
        <div style={{ ...container, padding: '12px 16px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <a href="/app" style={{ textDecoration: 'none', color: colors.ink, fontWeight: 700 }}>🐾 {label}</a>
              <span style={roleBadge(access.role)}>{ROLE_LABEL[access.role] || access.role}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <a href="/community" style={{ ...sub, color: colors.brand, textDecoration: 'none' }}>🌐 社群</a>
              <a href="/api/auth/logout" style={{ ...sub, color: colors.brand }}>登出</a>
            </div>
          </div>
          <nav style={{ display: 'flex', gap: 18, marginTop: 10, overflowX: 'auto', whiteSpace: 'nowrap' }}>
            {tabs.map((t) => (
              <a key={t.href} href={t.href} style={{ textDecoration: 'none', color: colors.ink, fontSize: 14, padding: '8px 0', fontWeight: 600, flex: '0 0 auto' }}>
                {t.label}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <div style={container}>{children}</div>
    </main>
  );
}
