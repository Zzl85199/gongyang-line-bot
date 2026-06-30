// app/app/ui.js
// 共用的版面樣式（inline style，不引入 CSS 框架，跟既有 album 頁一致的輕量做法）。
export const colors = {
  bg: '#f6f7f9',
  card: '#ffffff',
  ink: '#1f2329',
  sub: '#6b7280',
  line: '#e5e7eb',
  brand: '#2f7d5b',
  brandSoft: '#e8f3ed',
  danger: '#c0463b',
};

export const page = {
  minHeight: '100vh',
  margin: 0,
  background: colors.bg,
  color: colors.ink,
  fontFamily: 'system-ui, -apple-system, "Noto Sans TC", sans-serif',
};
export const container = { maxWidth: 880, margin: '0 auto', padding: '20px 16px 64px' };
export const card = {
  background: colors.card,
  border: `1px solid ${colors.line}`,
  borderRadius: 14,
  padding: 16,
  marginBottom: 14,
};
export const h1 = { fontSize: 22, fontWeight: 700, margin: '4px 0 2px' };
export const h2 = { fontSize: 16, fontWeight: 700, margin: '0 0 10px' };
export const sub = { color: colors.sub, fontSize: 13 };
export const btn = {
  display: 'inline-block',
  padding: '9px 14px',
  borderRadius: 10,
  border: 'none',
  background: colors.brand,
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  textDecoration: 'none',
};
export const btnGhost = {
  ...btn,
  background: colors.brandSoft,
  color: colors.brand,
  border: `1px solid ${colors.brand}`,
};
export const btnDanger = { ...btn, background: 'transparent', color: colors.danger, border: `1px solid ${colors.danger}` };
export const input = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '9px 11px',
  borderRadius: 10,
  border: `1px solid ${colors.line}`,
  fontSize: 14,
  background: '#fff',
  color: colors.ink,
};
export const badge = (bg, fg) => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  background: bg,
  color: fg,
});

export const ROLE_LABEL = { owner: '主飼主', caregiver: '照顧者', viewer: '唯讀', vet: '獸醫' };
export const roleBadge = (role) => {
  const map = {
    owner: ['#e8f3ed', '#2f7d5b'],
    caregiver: ['#eef2ff', '#4338ca'],
    viewer: ['#f3f4f6', '#6b7280'],
    vet: ['#fef3e2', '#b45309'],
  };
  const [bg, fg] = map[role] || map.viewer;
  return badge(bg, fg);
};
