// lib/petstate.js
// 寵物「照護狀態」模型 + 語氣/降檔系統 —— Doc 4 的靈魂層，也是最容易翻車的地方。
//
// 狀態（由高到低能量）：
//   vigor 活力 / companion 陪伴 / senior 熟齡 / treatment 療程 / hospice 安寧 / memorial 紀念
//
// 設計原則：
//   - 狀態只用來「悄悄調整內容」，不主動下判斷、不冷冰冰宣告。
//   - 年齡相關（活力/陪伴/熟齡）可自動推進；安寧、紀念這種重大轉換一律由飼主確認。
//
// 硬規則（最重要、不可違反）：
//   - memorial（已離世，pets.archived = true）：停止所有提醒與自動任務，絕不出現任何慶祝 UI。
//   - hospice（安寧，pets.care_state = 'hospice'）：仍發「藥物提醒」（命還是要顧），
//       但不自動丟任務、不播慶祝、語氣轉為最輕柔的陪伴。

// 病況關鍵字 → 視為「療程期」，活動一律只給最溫和的
const CONDITION_KW = [
  '關節', '骨', '心臟', '腎', '肝', '術後', '手術', '行動不便', '虛弱',
  '失明', '癲癇', '腫瘤', '癌', '糖尿', '虛', '臥床', '病', '洗腎', '化療',
];

export function hasConditionMarker(health) {
  return CONDITION_KW.some((k) => String(health || '').includes(k));
}

export function ageYears(pet) {
  if (!pet?.birthday) return null;
  const b = new Date(`${pet.birthday}T00:00:00+08:00`);
  return Math.max(0, (Date.now() - b.getTime()) / (365.25 * 86400000));
}

export function ageStage(pet) {
  const y = ageYears(pet);
  if (y == null) return 'adult';
  if (y < 1) return 'young';
  if (y <= 7) return 'adult';
  return 'senior';
}

// 推導目前狀態。優先序：紀念 > 安寧 > 療程(有病況) > 年齡
export function petState(pet) {
  if (!pet) return 'companion';
  if (pet.archived) return 'memorial';
  if (pet.care_state === 'hospice') return 'hospice';
  if (hasConditionMarker(pet.health)) return 'treatment';
  const s = ageStage(pet);
  if (s === 'young') return 'vigor';
  if (s === 'senior') return 'senior';
  return 'companion';
}

// 每個狀態對應的「語氣模式」：
//   celebrate  能不能播慶祝 UI（彩帶/🎉/解鎖）：on 開 / muted 收斂 / off 關
//   autoTask   是否會「自動」每週丟任務進群（手動問仍可，但安寧/紀念不主動丟）
//   taskLevels 可出現的活動強度（gentle 溫和 / medium 中等 / active 高活動）
//   voice      文案語氣：normal 一般 / tender 溫柔 / quiet 安靜
const TONE = {
  vigor:     { label: '活力期', celebrate: 'on',    autoTask: true,  taskLevels: ['gentle', 'medium'],            voice: 'normal' },
  companion: { label: '陪伴期', celebrate: 'on',    autoTask: true,  taskLevels: ['gentle', 'medium', 'active'],  voice: 'normal' },
  senior:    { label: '熟齡期', celebrate: 'muted', autoTask: true,  taskLevels: ['gentle', 'medium'],            voice: 'tender' },
  treatment: { label: '療程期', celebrate: 'muted', autoTask: true,  taskLevels: ['gentle'],                      voice: 'tender' },
  hospice:   { label: '安寧期', celebrate: 'off',   autoTask: false, taskLevels: ['gentle'],                      voice: 'quiet'  },
  memorial:  { label: '紀念期', celebrate: 'off',   autoTask: false, taskLevels: [],                              voice: 'quiet'  },
};

// 傳入 pet 物件或狀態字串都可以，回傳 { state, label, celebrate, autoTask, taskLevels, voice }
export function careTone(stateOrPet) {
  const state = typeof stateOrPet === 'string' ? stateOrPet : petState(stateOrPet);
  return { state, ...(TONE[state] || TONE.companion) };
}

// 是否允許播慶祝 UI（給未來的解鎖動畫/集滿慶祝當守門用）。
// 硬規則就是這一行：安寧、紀念一律 false。
export function canCelebrate(stateOrPet) {
  return careTone(stateOrPet).celebrate === 'on';
}
