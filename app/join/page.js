// app/join/page.js
// 對外授權的「邀請連結」落地頁。獸醫/保母點開 → 登入或註冊 → 按下確認即取得唯讀（或指定）權限。
import { getSessionUser } from '../../lib/session.js';
import * as webdb from '../../lib/webdb.js';
import { page, container, card, h1, h2, sub, btn, colors, roleBadge, ROLE_LABEL } from '../app/ui.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function Notice({ title, children }) {
  return (
    <main style={page}>
      <div style={{ ...container, maxWidth: 460 }}>
        <div style={{ ...card, marginTop: 40, textAlign: 'center' }}>
          <h1 style={h1}>{title}</h1>
          <div style={{ ...sub, marginTop: 8 }}>{children}</div>
        </div>
      </div>
    </main>
  );
}

export default async function Join({ searchParams }) {
  const token = typeof searchParams?.token === 'string' ? searchParams.token : '';
  if (searchParams?.bad) return <Notice title="連結無效 🐾">這條邀請連結找不到，請向對方重新索取。</Notice>;
  if (searchParams?.taken) return <Notice title="連結已被使用">這條邀請已經由其他帳號啟用了，請向對方索取新的連結。</Notice>;
  if (!token) return <Notice title="連結無效 🐾">缺少邀請碼。</Notice>;

  const grant = await webdb.getGrantByToken(token);
  if (!grant) return <Notice title="連結無效 🐾">這條邀請連結找不到，請向對方重新索取。</Notice>;

  const user = await getSessionUser();
  const groupPets = await (await import('../../lib/db.js')).listAllPets(grant.group_id);
  const label = webdb.petsLabel(groupPets);
  const role = grant.role;

  return (
    <main style={page}>
      <div style={{ ...container, maxWidth: 460 }}>
        <div style={{ textAlign: 'center', margin: '28px 0 14px' }}>
          <div style={{ fontSize: 32 }}>🤝</div>
          <h1 style={h1}>照護圈邀請</h1>
        </div>
        <div style={card}>
          <h2 style={h2}>{label}</h2>
          <p style={sub}>
            你被邀請以 <span style={roleBadge(role)}>{ROLE_LABEL[role] || role}</span> 的身分查看這個照護圈
            {role === 'viewer' || role === 'vet' ? '（唯讀：可以看，不會動到設定）' : ''}。
          </p>
          {groupPets.length > 0 && (
            <p style={{ ...sub, marginTop: 8 }}>毛孩：{groupPets.map((p) => p.name).join('、')}</p>
          )}
        </div>

        {user ? (
          <form method="post" action="/api/auth/redeem">
            <input type="hidden" name="token" value={token} />
            <button type="submit" style={{ ...btn, width: '100%' }}>以「{user.display_name || user.email}」身分加入</button>
          </form>
        ) : (
          <div style={card}>
            <p style={{ ...sub, marginBottom: 12 }}>請先登入或建立帳號，再啟用這條邀請。</p>
            <a href={`/login?next=${encodeURIComponent(`/join?token=${token}`)}`} style={{ ...btn, display: 'block', textAlign: 'center' }}>
              登入 / 註冊後繼續
            </a>
          </div>
        )}
        <p style={{ textAlign: 'center', ...sub, marginTop: 10 }}>
          <span style={{ color: colors.sub }}>授權隨時可由主飼主撤銷。</span>
        </p>
      </div>
    </main>
  );
}
