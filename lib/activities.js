// lib/activities.js
// 活動建議庫：依「強度」分三級，再依寵物的生命階段（由生日推算）與健康狀況自動挑選合適的。
// 原則：建議是邀請、不是作業；高齡或有病況時只給溫和的。

const ACT = {
  gentle: [
    { title: '摸摸時光', prompt: '拍一張牠最享受被摸的表情 😌' },
    { title: '睡顏捕捉', prompt: '拍下牠現在的睡相' },
    { title: '一起曬太陽', prompt: '陪牠靜靜曬十分鐘太陽 ☀️' },
    { title: '梳毛放鬆', prompt: '幫牠梳梳毛，拍張放鬆的樣子' },
    { title: '輕聲陪伴', prompt: '靠近牠輕聲說說今天的事，拍張合照' },
    { title: '最愛的部位', prompt: '找出牠最愛被摸的地方，拍下舒服的反應' },
  ],
  medium: [
    { title: '你丟我撿', prompt: '玩一場你丟我撿' },
    { title: '學個小把戲', prompt: '教握手或坐下，拍成功的瞬間' },
    { title: '新玩具', prompt: '拿個玩具陪牠玩十分鐘' },
    { title: '散步小冒險', prompt: '帶到附近走走，拍張到此一遊' },
    { title: '歪頭殺', prompt: '叫牠的名字，捕捉歪頭的瞬間' },
  ],
  active: [
    { title: '公園奔跑', prompt: '到草地讓牠盡情跑，拍奔跑的樣子' },
    { title: '長一點的健行', prompt: '走一段好走的步道，記錄沿途風景' },
    { title: '第一次看海', prompt: '帶牠去海邊，拍面對海浪的表情 🌊' },
    { title: '新地點探險', prompt: '探索一個你們沒去過的地方' },
  ],
};

// 病況關鍵字 → 一律只給溫和活動
const GENTLE_KW = ['關節', '骨', '心臟', '腎', '肝', '術後', '手術', '行動不便', '虛弱', '高齡', '失明', '癲癇', '腫瘤', '癌', '糖尿', '虛', '臥床', '病'];

export function ageYears(pet) {
  if (!pet?.birthday) return null;
  const b = new Date(`${pet.birthday}T00:00:00+08:00`);
  return Math.max(0, (Date.now() - b.getTime()) / (365.25 * 86400000));
}

function stageFromAge(years) {
  if (years == null) return 'adult';
  if (years < 1) return 'young';
  if (years <= 7) return 'adult';
  return 'senior';
}

function levelsFor(stage, health) {
  const h = String(health || '');
  if (GENTLE_KW.some((k) => h.includes(k))) return ['gentle'];
  if (stage === 'senior') return ['gentle', 'medium'];
  if (stage === 'young') return ['gentle', 'medium']; // 幼齡避免過度激烈
  return ['gentle', 'medium', 'active'];
}

const STAGE_LABEL = { young: '幼齡', adult: '成年', senior: '高齡' };

// 回傳一個適合這隻寵物的活動建議
export function suggestActivity(pet, lastTitle = null) {
  const years = ageYears(pet);
  const stage = stageFromAge(years);
  const levels = levelsFor(stage, pet.health);
  let pool = levels.flatMap((l) => ACT[l]).filter((a) => a.title !== lastTitle);
  if (!pool.length) pool = levels.flatMap((l) => ACT[l]);
  const a = pool[Math.floor(Math.random() * pool.length)];
  const note = GENTLE_KW.some((k) => String(pet.health || '').includes(k))
    ? `（依${pet.name}的狀況，挑了溫和的）`
    : `（依${STAGE_LABEL[stage]}體力挑選）`;
  return { ...a, note };
}
