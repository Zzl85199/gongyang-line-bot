// 簡單的 JSON 檔案儲存。MVP 夠用;之後要多台部署再換成資料庫。
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'db.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { groups: {} };
  }
}

let db = load();

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

// 取得某個 LINE 群（或一對一）的照護圈狀態,沒有就建一個帶預設值的
function getGroup(id) {
  if (!db.groups[id]) {
    db.groups[id] = {
      petName: null,
      meds: [],            // [{ id, name, times: ["08:00","20:00"] }]
      medLog: {},          // { "2026-06-19": { "<medId>@08:00": { done, by, byName, at } } }
      difficulty: '中等',   // 預設任務難度
      taskIntervalDays: 3, // 每幾天自動發一個任務
      lastTaskPushAt: null,
      lastTaskId: null,
      pendingTask: null,   // 正在等照片的任務
      lifebook: [],        // [{ type, taskTitle?, difficulty?, photo?, by, at }]
    };
  }
  return db.groups[id];
}

function allGroups() {
  return db.groups;
}

module.exports = { getGroup, allGroups, save };
