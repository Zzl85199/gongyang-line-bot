export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui, -apple-system, "Noto Sans TC", sans-serif', padding: 40, maxWidth: 560, margin: '0 auto' }}>
      <h1>共養日誌 🐾</h1>
      <p style={{ color: '#6b7280' }}>一家人在 LINE 群裡一起照顧毛孩，並有一個網頁後台。</p>
      <p style={{ marginTop: 20 }}>
        <a href="/app" style={{ display: 'inline-block', padding: '10px 16px', borderRadius: 10, background: '#2f7d5b', color: '#fff', textDecoration: 'none', fontWeight: 600 }}>
          進入網頁後台 →
        </a>
      </p>
      <p style={{ color: '#9aa0aa', fontSize: 13, marginTop: 24 }}>
        Webhook：<code>/api/webhook</code>　排程：<code>/api/cron</code>
      </p>
    </main>
  );
}
