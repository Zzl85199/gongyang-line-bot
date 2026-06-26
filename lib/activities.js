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
// 帶上 note/celebrate/voice/state，讓上層的訊息組裝可以決定語氣與是否慶祝。
export function suggestActivity(pet, lastTitle = null) {
  const tone = careTone(pet);
  const levels = tone.taskLevels;
  if (!levels.length) return null; // memorial：不給任務

  let pool = levels.flatMap((l) => ACT[l]).filter((a) => a.title !== lastTitle);
  if (!pool.length) pool = levels.flatMap((l) => ACT[l]);
  const a = pool[Math.floor(Math.random() * pool.length)];

  let note;
  if (tone.state === 'treatment' || tone.state === 'hospice') {
    note = `（依${pet.name}現在的狀況，挑了最溫柔的陪伴）`;
  } else if (tone.state === 'senior') {
    note = '（依熟齡的步調，挑了溫和的）';
  } else {
    note = '（挑了適合牠體力的）';
  }

  return { ...a, note, celebrate: tone.celebrate, voice: tone.voice, state: tone.state };
}

export { ageStage };
