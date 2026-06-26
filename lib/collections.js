// lib/collections.js
// 「圖鑑 / 收集冊」目錄。照片可歸到某個系列，集滿是「自己跟自己玩」的成就 —— 無排行、無懲罰。
// 進度 (n/target) 由 lifebook 裡該寵物、該 collection_key 的張數即時算出，不另存表。

export const COLLECTIONS = [
  { key: 'sleep',    title: '睡姿圖鑑',   emoji: '😴', target: 12 },
  { key: 'face',     title: '表情包冊',   emoji: '🤪', target: 12 },
  { key: 'walk',     title: '散步紀錄',   emoji: '🦮', target: 20 },
  { key: 'together', title: '一起合照',   emoji: '🫂', target: 12 },
  { key: 'firsts',   title: '第一次系列', emoji: '✨', target: 10 },
  { key: 'daily',    title: '日常時光',   emoji: '🐾', target: 30 },
];

const BY_KEY = Object.fromEntries(COLLECTIONS.map((c) => [c.key, c]));

export const getCollection = (key) => BY_KEY[key] || null;
export const collectionTitle = (key) => BY_KEY[key]?.title || null;

// 收照片時，快速回覆要提供的幾個選項（不放全部，避免太長）
export const QUICK_PICK = ['sleep', 'face', 'walk', 'together'];
