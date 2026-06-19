// 任務庫。依難度分三級;簡單=低活動量/溫柔,困難=高活動量/特別時刻。
// 設計原則:任務是邀請,不是作業 —— 沒做到不懲罰、不計分。
const TASKS = {
  '簡單': [
    { id: 's1', title: '摸屁屁時光', prompt: '拍一張牠最享受被摸的表情 😌' },
    { id: 's2', title: '睡顏捕捉', prompt: '拍下牠現在睡覺的樣子' },
    { id: 's3', title: '一起曬太陽', prompt: '陪牠曬十分鐘太陽,拍張合照 ☀️' },
    { id: 's4', title: '零食的眼神', prompt: '給一個零食,拍下牠期待的眼神' },
    { id: 's5', title: '最愛的部位', prompt: '找出牠最愛被摸的地方,拍下舒服的反應' },
    { id: 's6', title: '歪頭殺', prompt: '叫牠的名字,捕捉那個歪頭的瞬間' },
    { id: 's7', title: '梳毛時光', prompt: '幫牠梳梳毛,拍張放鬆的樣子' },
    { id: 's8', title: '呆萌時刻', prompt: '拍下牠今天最呆萌的一瞬間' },
  ],
  '中等': [
    { id: 'm1', title: '學個新把戲', prompt: '教一個小指令(握手、坐下),拍成功的瞬間' },
    { id: 'm2', title: '你丟我撿', prompt: '玩一場你丟我撿,拍牠奔跑的樣子' },
    { id: 'm3', title: '公園散步', prompt: '帶到附近公園走走,拍張到此一遊' },
    { id: 'm4', title: '新玩具開箱', prompt: '用一個新玩具陪牠玩十分鐘' },
    { id: 'm5', title: '鬥智餵藥成功', prompt: '成功騙牠把藥吃下去?拍張你的得意照 😏' },
    { id: 'm6', title: '小小障礙賽', prompt: '設一個小障礙,拍牠跨過去的瞬間' },
  ],
  '困難': [
    { id: 'h1', title: '一起去爬山', prompt: '挑一座好走的小山,拍張登頂照 ⛰️' },
    { id: 'h2', title: '第一次看海', prompt: '帶牠去海邊,拍下面對海浪的表情 🌊' },
    { id: 'h3', title: '長程健行', prompt: '來一趟長一點的健行,記錄沿途風景' },
    { id: 'h4', title: '新地點探險', prompt: '探索一個你們從沒去過的地方' },
    { id: 'h5', title: '野餐日', prompt: '安排一次戶外野餐,拍張全家福 🧺' },
  ],
};

const DIFFICULTIES = ['簡單', '中等', '困難'];

// 從指定難度抽一個任務,盡量避開上次給過的那個
function pickTask(difficulty, lastId) {
  const list = TASKS[difficulty] || TASKS['中等'];
  let pool = list.filter((t) => t.id !== lastId);
  if (pool.length === 0) pool = list;
  const t = pool[Math.floor(Math.random() * pool.length)];
  return { ...t, difficulty: TASKS[difficulty] ? difficulty : '中等' };
}

module.exports = { TASKS, DIFFICULTIES, pickTask };
