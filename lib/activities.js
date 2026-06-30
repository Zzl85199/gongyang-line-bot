// lib/activities.js
// 活動建議庫：依「強度」分三級。可出哪些強度、語氣如何，一律交給 petstate 的 careTone 決定，
// 確保跟提醒、慶祝 UI 用同一套狀態邏輯（單一事實來源）。
// 原則：建議是邀請、不是作業；高齡/療程/安寧只給溫和的；紀念期不給任務。

import { careTone, ageStage } from './petstate.js';

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

// 回傳一個適合這隻寵物的活動建議；紀念期回傳 null（不給任務）。
// 帶上 note/celebrate/voice/state/level/allowed，讓上層的訊息組裝可以決定語氣、是否慶祝、
// 以及要不要顯示「換一個 / 簡單一點 / 想動一動」這些按鈕。
//
// opts:
//   lastTitle 抽過的題目（避免連續抽到同一個）
//   level     指定難度 'gentle'|'medium'|'active'（會被狀態允許的範圍夾住；不在範圍內就忽略）
// 為相容舊呼叫，第二參數也接受字串（視為 lastTitle）。
export function suggestActivity(pet, opts = null) {
  const o = typeof opts === 'string' ? { lastTitle: opts } : opts || {};
  const lastTitle = o.lastTitle || null;
  const wantLevel = o.level || null;

  const tone = careTone(pet);
  const allowed = tone.taskLevels;       // 這隻寵物現在可出現的難度（單一事實來源）
  if (!allowed.length) return null;      // memorial：不給任務

  // 指定難度且被允許 → 只從那一級抽；否則從全部允許的級別抽
  const useLevels = wantLevel && allowed.includes(wantLevel) ? [wantLevel] : allowed;

  const withLevel = (ls) => ls.flatMap((l) => ACT[l].map((a) => ({ ...a, level: l })));
  let pool = withLevel(useLevels).filter((a) => a.title !== lastTitle);
  if (!pool.length) pool = withLevel(useLevels);
  const a = pool[Math.floor(Math.random() * pool.length)];

  let note;
  if (tone.state === 'treatment' || tone.state === 'hospice') {
    note = `（依${pet.name}現在的狀況，挑了最溫柔的陪伴）`;
  } else if (tone.state === 'senior') {
    note = '（依熟齡的步調，挑了溫和的）';
  } else if (a.level === 'gentle' && allowed.length > 1) {
    note = '（挑了輕鬆一點的）';
  } else if (a.level === 'active') {
    note = '（來點有活力的）';
  } else {
    note = '（挑了適合牠體力的）';
  }

  return {
    ...a,
    note,
    celebrate: tone.celebrate,
    voice: tone.voice,
    state: tone.state,
    level: a.level,
    allowed,
  };
}

export { ageStage };
