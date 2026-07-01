'use client';
// app/community/[postId]/CommunityPostDetail.jsx
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { page, container, card, sub, btn, btnGhost, btnDanger, input, colors, badge } from '../../app/ui.js';

const KIND_LABEL = { post: '動態', question: '問答', resource: '找保母・送養' };

async function action(body) {
  const r = await fetch('/api/app/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
function fmtFull(iso) {
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export default function CommunityPostDetail({ initialPost, initialComments, myUserId }) {
  const router = useRouter();
  const [post, setPost] = useState(initialPost);
  const [comments, setComments] = useState(initialComments);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const isAuthor = post.authorUserId && String(post.authorUserId) === String(myUserId);

  async function toggleLike() {
    setPost({ ...post, liked: !post.liked, likeCount: post.likeCount + (post.liked ? -1 : 1) });
    const j = await action({ kind: 'community.like', postId: post.id });
    if (!j.ok) router.refresh();
  }
  async function sendComment() {
    if (!text.trim()) return;
    setBusy(true);
    const j = await action({ kind: 'community.comment', postId: post.id, body: text });
    setBusy(false);
    if (j.ok) { setComments([...comments, { id: j.comment.id, body: j.comment.body, authorName: j.comment.author_name, authorUserId: j.comment.author_user_id, createdAt: j.comment.created_at }]); setText(''); }
    else alert('留言失敗：' + j.error);
  }
  async function delComment(id) {
    if (!confirm('刪除這則留言？')) return;
    const j = await action({ kind: 'community.commentDelete', commentId: id });
    if (j.ok) setComments(comments.filter((c) => c.id !== id)); else alert('刪除失敗：' + j.error);
  }
  async function delPost() {
    if (!confirm('刪除這篇貼文？')) return;
    const j = await action({ kind: 'community.delete', postId: post.id });
    if (j.ok) router.push('/community'); else alert('刪除失敗：' + j.error);
  }

  return (
    <main style={page}>
      <div style={container}>
        <a href="/community" style={{ ...sub, color: colors.brand, textDecoration: 'none' }}>← 回社群</a>

        <div style={{ ...card, marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <a href={`/community/pet/${post.petId}`} style={{ fontWeight: 600, color: colors.ink, textDecoration: 'none' }}>{post.petName}</a>
            <span style={{ ...sub, fontSize: 12 }}>{post.species ? `${post.species}・` : ''}{fmtFull(post.createdAt)}</span>
            <span style={{ ...badge('#f1f2f4', colors.sub), marginLeft: 'auto' }}>{KIND_LABEL[post.kind]}</span>
          </div>
          <p style={{ fontSize: 15, lineHeight: 1.8, whiteSpace: 'pre-wrap', margin: '0 0 10px' }}>{post.body}</p>
          {post.photoUrl && <img src={post.photoUrl} alt="" style={{ width: '100%', borderRadius: 10, marginBottom: 10 }} />}
          {post.kind === 'resource' && (post.region || post.duration) && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              {post.region && <span style={badge('#eef2ff', '#4338ca')}>📍 {post.region}</span>}
              {post.duration && <span style={badge('#eef2ff', '#4338ca')}>🗓️ {post.duration}</span>}
            </div>
          )}
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <button onClick={toggleLike} style={{ border: 'none', background: 'none', cursor: 'pointer', color: post.liked ? colors.brand : colors.sub, fontSize: 14, padding: 0 }}>
              {post.liked ? '❤️' : '🤍'} {post.likeCount}
            </button>
            {isAuthor && <button style={btnDanger} onClick={delPost}>刪除貼文</button>}
          </div>
        </div>

        <div style={card}>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>留言（{comments.length}）</h2>
          {comments.length === 0 ? (
            <span style={sub}>還沒有留言，當第一個吧。</span>
          ) : (
            comments.map((c) => (
              <div key={c.id} style={{ padding: '8px 0', borderTop: `1px solid ${colors.line}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13 }}><b>{c.authorName || '一位飼主'}</b> <span style={{ ...sub, fontSize: 12 }}>{fmtFull(c.createdAt)}</span></span>
                  {String(c.authorUserId) === String(myUserId) && (
                    <button onClick={() => delComment(c.id)} style={{ border: 'none', background: 'none', color: colors.danger, cursor: 'pointer', fontSize: 12, padding: 0 }}>刪除</button>
                  )}
                </div>
                <p style={{ fontSize: 14, margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{c.body}</p>
              </div>
            ))
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input style={input} placeholder="留言…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') sendComment(); }} />
            <button style={btn} onClick={sendComment} disabled={busy}>送出</button>
          </div>
        </div>
      </div>
    </main>
  );
}
