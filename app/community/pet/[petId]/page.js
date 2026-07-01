// app/community/pet/[petId]/page.js
// 毛孩公開主頁：只顯示飼主選擇公開的資訊，跟私密的相簿/健康頁完全分開，
// 只給名字/物種/簡介 + 這隻毛孩在社群發過的貼文，不會洩漏照護圈裡的私密資料。
import { notFound } from 'next/navigation';
import * as community from '../../../../lib/community.js';
import { page, container, card, h1, sub, badge } from '../../../app/ui.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function ageText(birthday) {
  if (!birthday) return null;
  const y = (Date.now() - new Date(birthday).getTime()) / (365.25 * 86400000);
  if (y < 1) return `${Math.round(y * 12)} 個月`;
  return `${Math.round(y * 10) / 10} 歲`;
}
function fmtDate(iso) {
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' }).format(new Date(iso));
}
const KIND_LABEL = { post: '動態', question: '問答', resource: '找保母・送養' };

export default async function PublicPetPage({ params }) {
  const petId = Number(params.petId);
  const pet = await community.getPublicPet(petId);
  if (!pet) notFound();

  const posts = await community.listPostsByPet(petId, 30);
  const photoUrls = await Promise.all(posts.map((p) => (p.photo_path ? community.signedCommunityPhotoUrl(p.photo_path) : null)));

  return (
    <main style={page}>
      <div style={container}>
        <a href="/community" style={{ ...sub, color: '#2f7d5b', textDecoration: 'none' }}>← 回社群</a>

        <div style={{ ...card, marginTop: 12, textAlign: 'center' }}>
          <h1 style={{ ...h1, textAlign: 'center' }}>{pet.name}</h1>
          <p style={sub}>{[pet.species, ageText(pet.birthday)].filter(Boolean).join('・') || '毛孩'}</p>
          {pet.public_bio && <p style={{ fontSize: 14, lineHeight: 1.7, marginTop: 10 }}>{pet.public_bio}</p>}
        </div>

        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '4px 0 10px' }}>在社群發過的貼文</h2>
        {posts.length === 0 ? (
          <div style={card}><span style={sub}>還沒有發過貼文。</span></div>
        ) : (
          posts.map((p, i) => (
            <a key={p.id} href={`/community/${p.id}`} style={{ ...card, display: 'block', textDecoration: 'none', color: '#1f2329' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={badge('#f1f2f4', '#6b7280')}>{KIND_LABEL[p.kind]}</span>
                <span style={sub}>{fmtDate(p.created_at)}</span>
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>{p.body}</p>
              {photoUrls[i] && <img src={photoUrls[i]} alt="" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 10, marginTop: 8 }} />}
            </a>
          ))
        )}
      </div>
    </main>
  );
}
