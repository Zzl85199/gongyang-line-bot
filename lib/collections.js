// lib/collections.js
// 「圖鑑 / 收集冊」目錄。改版後的精神（呼應 Doc 4：無 fail state、不競爭、自己跟自己玩）：
//   - series 系列：開放式，不設終點、不顯示分母，只累積張數；到 5/10/20… 的柔性里程碑會給溫暖回饋、
//                  並自動把這系列拼成一張可分享的回顧卡。
//   - milestone 重要時刻：事件型，一個個有意義的瞬間（第一次、認養週年…），不算進度、不喊集滿。
//   - 自訂圖鑑：使用者自己開的 series（存在 DB 的 custom_collections，key = 'c'+id）。

export const COLLECTIONS = [
  { key: 'sleep',     title: '睡姿圖鑑',   emoji: '😴', kind: 'series' },
  { key: 'face',      title: '表情包冊',   emoji: '🤪', kind: 'series' },
  { key: 'walk',      title: '散步紀錄',   emoji: '🦮', kind: 'series' },
  { key: 'together',  title: '一起合照',   emoji: '🫂', kind: 'series' },
  { key: 'daily',     title: '日常時光',   emoji: '🐾', kind: 'series' },
  { key: 'milestone', title: '重要時刻',   emoji: '🏅', kind: 'milestone' },
];

const BY_KEY = Object.fromEntries(COLLECTIONS.map((c) => [c.key, c]));
export const getCollection = (key) => BY_KEY[key] || null;

// 系列的柔性里程碑張數（到這些數字時給回饋 + 自動拼回顧卡）
export const MILESTONE_STEPS = [5, 10, 20, 30, 50, 75, 100];
export const isMilestoneCount = (n) => MILESTONE_STEPS.includes(n);

// 收照片時，快速回覆先給這幾個（其餘走「更多分類」）
export const QUICK_PICK = ['sleep', 'face', 'walk', 'milestone'];
