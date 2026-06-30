// app/login/page.js
// 登入 / 註冊頁。可用 LINE 登入（與機器人同 provider 時自動對上家人身分），或 Email 帳號。
import { lineConfigured } from '../../lib/auth.js';
import { getSessionUser } from '../../lib/session.js';
import { redirect } from 'next/navigation';
import { page, container, card, h1, h2, sub, btn, btnGhost, input, colors } from '../app/ui.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ERRORS = {
  bad: '帳號或密碼不對，再試一次。',
  missing: '請填 Email 和密碼。',
  weak: '密碼至少 6 個字。',
  exists: '這個 Email 已經註冊過了，直接登入吧。',
  server: '伺服器忙不過來，稍後再試。',
  line_off: '這個站台還沒設定 LINE 登入，先用 Email 吧。',
  oauth: 'LINE 登入沒成功，再試一次。',
  oauth_state: 'LINE 登入逾時或連結失效，請重新點一次。',
  oauth_profile: '拿不到 LINE 個人資料，再試一次。',
  need_login: '請先登入，才能開啟這個連結。',
};

export default async function Login({ searchParams }) {
  const user = await getSessionUser();
  const next = typeof searchParams?.next === 'string' ? searchParams.next : '/app';
  if (user) redirect(next.startsWith('/') ? next : '/app');

  const mode = searchParams?.mode === 'signup' ? 'signup' : 'login';
  const err = typeof searchParams?.error === 'string' ? ERRORS[searchParams.error] : null;
  const lineOn = lineConfigured();

  return (
    <main style={page}>
      <div style={{ ...container, maxWidth: 420 }}>
        <div style={{ textAlign: 'center', margin: '24px 0 18px' }}>
          <div style={{ fontSize: 34 }}>🐾</div>
          <h1 style={h1}>共養日誌</h1>
          <p style={sub}>一家人一起照顧毛孩的後台</p>
        </div>

        {err && (
          <div style={{ ...card, background: '#fff4f2', border: `1px solid ${colors.danger}`, color: colors.danger, marginBottom: 12 }}>
            {err}
          </div>
        )}

        {lineOn && (
          <a href={`/api/auth/line/start?next=${encodeURIComponent(next)}`} style={{ ...btn, display: 'block', textAlign: 'center', background: '#06C755', marginBottom: 14 }}>
            用 LINE 登入
          </a>
        )}

        <div style={card}>
          <h2 style={h2}>{mode === 'signup' ? '建立 Email 帳號' : 'Email 登入'}</h2>
          <form method="post" action={mode === 'signup' ? '/api/auth/signup' : '/api/auth/login'}>
            <input type="hidden" name="next" value={next} />
            {mode === 'signup' && (
              <div style={{ marginBottom: 10 }}>
                <label style={sub}>顯示名稱（選填）</label>
                <input style={input} name="name" placeholder="例如：媽媽" autoComplete="name" />
              </div>
            )}
            <div style={{ marginBottom: 10 }}>
              <label style={sub}>Email</label>
              <input style={input} name="email" type="email" required placeholder="you@example.com" autoComplete="email" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={sub}>密碼</label>
              <input style={input} name="password" type="password" required placeholder={mode === 'signup' ? '至少 6 個字' : ''} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
            </div>
            <button type="submit" style={{ ...btn, width: '100%' }}>
              {mode === 'signup' ? '註冊並登入' : '登入'}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', ...sub }}>
          {mode === 'signup' ? (
            <a href={`/login?next=${encodeURIComponent(next)}`} style={{ color: colors.brand }}>已經有帳號了？登入</a>
          ) : (
            <a href={`/login?mode=signup&next=${encodeURIComponent(next)}`} style={{ color: colors.brand }}>還沒有帳號？用 Email 註冊</a>
          )}
        </p>

        <p style={{ textAlign: 'center', ...sub, marginTop: 18, lineHeight: 1.6 }}>
          家人請用平常加群組的那個 LINE 帳號登入，<br />會自動對上你照顧的毛孩 🐾
        </p>
      </div>
    </main>
  );
}
