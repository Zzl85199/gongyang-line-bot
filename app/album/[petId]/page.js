// app/album/[petId]/page.js
// 可保存的「生命之書紀念冊」網頁：自動播放的照片幻燈片 + 縮圖牆。
// 用簽章 URL 取私有照片；連結帶 token 簡單防護。每次開啟會重新產生有效的圖片網址。
import { albumToken } from '../../../lib/album.js';
import * as db from '../../../lib/db.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const wrap = { minHeight: '100vh', margin: 0, background: '#0f1115', color: '#e8e6e1', fontFamily: 'system-ui, -apple-system, "Noto Sans TC", sans-serif' };

function Notice({ children }) {
  return (
    <main style={{ ...wrap, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
      <div>{children}</div>
    </main>
  );
}

export default async function Album({ params, searchParams }) {
  const petId = Number(params.petId);
  const k = searchParams?.k;
  if (!petId || k !== albumToken(petId)) return <Notice>連結無效或已過期 🐾</Notice>;

  const pet = await db.getPet(petId);
  if (!pet) return <Notice>找不到這本生命之書。</Notice>;

  const all = await db.recentLifebook(petId, 300);
  const photos = all.filter((e) => e.photo_path).reverse(); // 由舊到新
  const urls = await Promise.all(photos.map((e) => db.signedPhotoUrl(e.photo_path, 7 * 24 * 3600)));
  const slides = photos
    .map((e, i) => ({
      url: urls[i],
      date: fmt(e.created_at),
      title: e.task_title || e.caption || '',
    }))
    .filter((s) => s.url);

  const title = pet.archived ? `🕊️ 紀念 ${pet.name}` : `📖 ${pet.name} 的生命之書`;

  if (!slides.length) {
    return (
      <Notice>
        <h1 style={{ fontWeight: 600 }}>{title}</h1>
        <p style={{ color: '#9aa0aa' }}>還沒有照片，把照片傳進群組就會出現在這裡。</p>
      </Notice>
    );
  }

  const data = JSON.stringify(slides);
  const script = `
    (function(){
      var slides = ${data};
      var i = 0, timer = null;
      var img = document.getElementById('hero');
      var cap = document.getElementById('cap');
      var dateEl = document.getElementById('date');
      function show(n){
        i = (n + slides.length) % slides.length;
        img.style.opacity = 0;
        setTimeout(function(){
          img.src = slides[i].url;
          cap.textContent = slides[i].title || '';
          dateEl.textContent = slides[i].date || '';
          img.style.opacity = 1;
        }, 220);
      }
      function next(){ show(i+1); }
      function prev(){ show(i-1); }
      function play(){ stop(); timer = setInterval(next, 3200); }
      function stop(){ if(timer){ clearInterval(timer); timer=null; } }
      document.getElementById('next').onclick = function(){ next(); play(); };
      document.getElementById('prev').onclick = function(){ prev(); play(); };
      Array.prototype.forEach.call(document.querySelectorAll('[data-idx]'), function(el){
        el.onclick = function(){ show(parseInt(el.getAttribute('data-idx'),10)); play(); };
      });
      show(0); play();
    })();
  `;

  return (
    <main style={wrap}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 16px 60px' }}>
        <h1 style={{ fontWeight: 600, fontSize: 22, textAlign: 'center', margin: '8px 0 4px' }}>{title}</h1>
        <p style={{ textAlign: 'center', color: '#9aa0aa', margin: '0 0 20px', fontSize: 14 }}>
          共 {slides.length} 個時光{pet.archived ? '・願你一切安好' : ''}
        </p>

        <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', background: '#000', aspectRatio: '1 / 1' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img id="hero" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'opacity .3s' }} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '28px 16px 14px', background: 'linear-gradient(transparent, rgba(0,0,0,.7))' }}>
            <div id="date" style={{ fontSize: 12, color: '#cfd3da' }} />
            <div id="cap" style={{ fontSize: 16, fontWeight: 600 }} />
          </div>
          <button id="prev" aria-label="prev" style={navBtn('left')}>‹</button>
          <button id="next" aria-label="next" style={navBtn('right')}>›</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 14 }}>
          {slides.map((s, idx) => (
            <img
              key={idx}
              data-idx={idx}
              src={s.url}
              alt=""
              style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 8, cursor: 'pointer', opacity: 0.85 }}
            />
          ))}
        </div>

        <p style={{ textAlign: 'center', color: '#6b7280', fontSize: 12, marginTop: 24 }}>
          共養日誌・想保存可直接用瀏覽器「列印 → 存成 PDF」
        </p>
      </div>
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </main>
  );
}

function navBtn(side) {
  return {
    position: 'absolute',
    top: '50%',
    [side]: 8,
    transform: 'translateY(-50%)',
    width: 40,
    height: 40,
    borderRadius: 20,
    border: 'none',
    background: 'rgba(0,0,0,.35)',
    color: '#fff',
    fontSize: 24,
    lineHeight: '38px',
    cursor: 'pointer',
  };
}

function fmt(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(iso));
}
