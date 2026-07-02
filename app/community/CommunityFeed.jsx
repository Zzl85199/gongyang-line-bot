'use client';
// app/community/CommunityFeed.jsx
// 社群首頁：篩選 chip（全部/動態/問答/找保母送養）+ 發文 + 卡片列表。
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { page, container, card, h1, sub, btn, btnGhost, input, colors, badge } from '../app/ui.js';

const KIND_LABEL = { post: '動態', question: '問答', resource: '找保母・送養' };
const KIND_COLOR = { post: ['#e8f3ed', '#2f7d5b'], question: ['#fef3e2', '#b45309'], resource: ['#eef2ff', '#4338ca'] };
const FILTERS = [['all', '全部'], ['post', '動態'], ['question', '問答'], ['resource', '找保母・送養']];

async function action(body) {
  const r = await fetch('/api/app/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
function fmtTime(iso) {
  const d = new Date(iso);
  const now = Date.now();
  const diffMin = Math.floor((now - d.getTime()) / 60000);
  if (diffMin < 60) return `${Math.max(1, diffMin)} 分鐘前`;
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)} 小時前`;
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' }).format(d);
}

function Composer({ myPublicPets, onCreated, groupId, forceOpenKind, onConsumeForceOpen }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('post');
  const [petId, setPetId] = useState(myPublicPets[0]?.id || '');
  const [body, setBody] = useState('');
  const [region, setRegion] = useState('');
  const [duration, setDuration] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!forceOpenKind) return;
    setOpen(true);
    setKind(forceOpenKind);
    onConsumeForceOpen?.();
  }, [forceOpenKind]);

  async function submit() {
    if (!petId || !body.trim()) return;
    setBusy(true);
    const j = await action({ kind: 'community.create', petId, postKind: kind, body, region, duration });
    if (j.ok && file) {
      const fd = new FormData();
      fd.append('postId', j.post.id);
      fd.append('file', file);
      await fetch('/api/app/community-photo', { method: 'POST', body: fd });
    }
    setBusy(false);
    if (j.ok) {
      setBody(''); setRegion(''); setDuration(''); setFile(null); setOpen(false);
      onCreated();
    } else alert('發文失敗：' + j.error);
  }

  if (!myPublicPets.length) {
    return (
      <div style={{ ...card, background: colors.brandSoft, border: 'none' }}>
        <span style={sub}>要發文得先有一隻「公開到社群」的毛孩。到「毛孩檔案」頁開啟公開開關就能回來發文了。</span>
        {groupId && (
          <div style={{ marginTop: 10 }}>
            <a href={`/app/${encodeURIComponent(groupId)}/pets`} style={btn}>前往「毛孩檔案」開啟公開 →</a>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={card}>
      {!open ? (
        <button style={btn} onClick={() => setOpen(true)}>＋ 發文</button>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(KIND_LABEL).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                style={{ padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: `1px solid ${kind === k ? colors.brand : colors.line}`, background: kind === k ? colors.brandSoft : '#fff', color: kind === k ? colors.brand : colors.sub }}
              >
                {l}
              </button>
            ))}
          </div>
          <select style={input} value={petId} onChange={(e) => setPetId(Number(e.target.value))}>
            {myPublicPets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <textarea style={{ ...input, minHeight: 80, resize: 'vertical' }} placeholder="想分享什麼？" value={body} onChange={(e) => setBody(e.target.value)} />
          {kind === 'resource' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={input} placeholder="地區（例：台北中山區）" value={region} onChange={(e) => setRegion(e.target.value)} />
              <input style={input} placeholder="期間（例：3 天 / 長期）" value={duration} onChange={(e) => setDuration(e.target.value)} />
            </div>
          )}
          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn} onClick={submit} disabled={busy}>送出</button>
            <button style={btnGhost} onClick={() => setOpen(false)}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
}

function PostCard({ post, onToggleLike }) {
  const [c, f] = KIND_COLOR[post.kind] || KIND_COLOR.post;
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <a href={`/community/pet/${post.petId}`} style={{ fontWeight: 600, color: colors.ink, textDecoration: 'none', fontSize: 14 }}>{post.petName}</a>
        <span style={{ ...sub, fontSize: 12 }}>{post.species ? `${post.species}・` : ''}{fmtTime(post.createdAt)}</span>
        <span style={{ ...badge(c, f), marginLeft: 'auto' }}>{KIND_LABEL[post.kind]}</span>
      </div>
      <a href={`/community/${post.id}`} style={{ textDecoration: 'none', color: colors.ink }}>
        <p style={{ fontSize: 14, lineHeight: 1.7, margin: '0 0 8px', whiteSpace: 'pre-wrap' }}>{post.body}</p>
        {post.photoUrl && <img src={post.photoUrl} alt="" style={{ width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 10, marginBottom: 8 }} />}
      </a>
      {post.kind === 'resource' && (post.region || post.duration) && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          {post.region && <span style={badge('#f1f2f4', colors.sub)}>📍 {post.region}</span>}
          {post.duration && <span style={badge('#f1f2f4', colors.sub)}>🗓️ {post.duration}</span>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, fontSize: 13, color: colors.sub }}>
        <button onClick={() => onToggleLike(post.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: post.liked ? colors.brand : colors.sub, fontSize: 13, padding: 0 }}>
          {post.liked ? '❤️' : '🤍'} {post.likeCount}
        </button>
        <a href={`/community/${post.id}`} style={{ color: colors.sub, textDecoration: 'none' }}>💬 留言</a>
      </div>
    </div>
  );
}

export default function CommunityFeed({ initialPosts, myPublicPets, firstGroupId }) {
  const router = useRouter();
  const [filter, setFilter] = useState('all');
  const [posts, setPosts] = useState(initialPosts);
  const [forceKind, setForceKind] = useState(null);

  const shown = filter === 'all' ? posts : posts.filter((p) => p.kind === filter);

  async function toggleLike(postId) {
    setPosts(posts.map((p) => (p.id === postId ? { ...p, liked: !p.liked, likeCount: p.likeCount + (p.liked ? -1 : 1) } : p)));
    const j = await action({ kind: 'community.like', postId });
    if (!j.ok) router.refresh();
  }

  return (
    <main style={page}>
      <div style={container}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 4px' }}>
          <h1 style={h1}>社群</h1>
          <a href="/app" style={{ ...sub, color: colors.brand, textDecoration: 'none' }}>← 回照護圈</a>
        </div>
        <p style={{ ...sub, marginBottom: 12 }}>不同飼主之間的公開動態、問答與找保母送養。</p>

        <div style={{ ...card, background: colors.brandSoft, border: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <button style={btn} onClick={() => setForceKind('resource')}>🔍 找保母／送養（公開發文）</button>
          <span style={{ ...sub, fontSize: 12 }}>
            只是想請「已經認識」的人幫忙臨托？不用公開毛孩資料，
            {firstGroupId ? (
              <a href={`/app/${encodeURIComponent(firstGroupId)}/pets`} style={{ color: colors.brand }}> 用「交接卡」分享給對方更快 →</a>
            ) : (
              ' 用「交接卡」分享給對方更快。'
            )}
          </span>
        </div>

        <Composer
          myPublicPets={myPublicPets}
          onCreated={() => router.refresh()}
          groupId={firstGroupId}
          forceOpenKind={forceKind}
          onConsumeForceOpen={() => setForceKind(null)}
        />

        <div style={{ display: 'flex', gap: 8, margin: '14px 0', flexWrap: 'wrap' }}>
          {FILTERS.map(([k, l]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              style={{ padding: '6px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: `1px solid ${filter === k ? colors.brand : colors.line}`, background: filter === k ? colors.brandSoft : '#fff', color: filter === k ? colors.brand : colors.sub }}
            >
              {l}
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <div style={card}><span style={sub}>這個分類還沒有貼文，來當第一篇吧 🐾</span></div>
        ) : (
          shown.map((p) => <PostCard key={p.id} post={p} onToggleLike={toggleLike} />)
        )}
      </div>
    </main>
  );
}
