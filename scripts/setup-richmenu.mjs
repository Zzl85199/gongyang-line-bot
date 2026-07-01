// scripts/setup-richmenu.mjs
// 一次性設定腳本：建立 LINE 官方帳號的「常駐選單列」（Rich Menu）並設成預設。
// 使用者不用打字，點按鈕就能觸發散步/健康/今天/相簿/更多，是把常用功能降到零門檻的做法。
//
// 用法：
//   1. 在專案根目錄執行： node scripts/setup-richmenu.mjs
//   2. 需要環境變數 LINE_CHANNEL_ACCESS_TOKEN（跟 Vercel 上設的是同一個）
//   3. 選填 PUBLIC_BASE_URL（給「相簿」按鈕連到網頁版用；沒設就先連到 LIFF/官方帳號首頁的替代文字）
//
// 圖片：scripts/richmenu.png 是先幫你生成的簡易版（純色分色塊+文字），可以直接拿去用，
// 也可以自己用 Canva/Figma 做一張更漂亮的圖再換掉這個檔案——只要維持 2500x843 尺寸即可。
//
// 這支腳本只需要跑一次；之後要換圖或調整按鈕，改這支腳本重新跑一次即可（會建立新的 Rich Menu 並覆蓋預設）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('缺少環境變數 LINE_CHANNEL_ACCESS_TOKEN，請先設定再執行。');
  process.exit(1);
}

const BASE = 'https://api.line.me/v2/bot';
const DATA = 'https://api-data.line.me/v2/bot';
const IMAGE_PATH = path.join(__dirname, 'richmenu.png');

const W = 2500;
const H = 843;
const COL = Math.floor(W / 5);

// 5 個按鈕，對應現有指令/postback：
//   散步 → 文字訊息「散步」（既有的一鍵記散步指令，馬上觸發、不用打字）
//   健康 → postback a=healthmenu（先選體重/食慾/症狀/備註，統一入口）
//   今天 → 文字訊息「今天」（既有的今日狀態指令）
//   相簿 → 開啟網頁版（登入後可看所有毛孩的生命之書相簿）
//   更多 → postback a=help（完整指令說明，按【常用】/【進階】分段）
const baseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const areas = [
  { bounds: { x: 0 * COL, y: 0, width: COL, height: H }, action: { type: 'message', label: '散步', text: '散步' } },
  { bounds: { x: 1 * COL, y: 0, width: COL, height: H }, action: { type: 'postback', label: '健康', data: 'a=healthmenu' } },
  { bounds: { x: 2 * COL, y: 0, width: COL, height: H }, action: { type: 'message', label: '今天', text: '今天' } },
  baseUrl
    ? { bounds: { x: 3 * COL, y: 0, width: COL, height: H }, action: { type: 'uri', label: '相簿', uri: `${baseUrl}/app` } }
    : { bounds: { x: 3 * COL, y: 0, width: COL, height: H }, action: { type: 'message', label: '相簿', text: '回顧' } },
  { bounds: { x: 4 * COL, y: 0, width: COL, height: H }, action: { type: 'postback', label: '更多', data: 'a=help' } },
];

async function main() {
  if (!fs.existsSync(IMAGE_PATH)) {
    console.error(`找不到圖片：${IMAGE_PATH}\n請放一張 2500x843（或 2500x1686）的 PNG/JPEG 進去，檔名 richmenu.png。`);
    process.exit(1);
  }

  console.log('1/4 建立 Rich Menu 定義…');
  const createRes = await fetch(`${BASE}/richmenu`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      size: { width: W, height: H },
      selected: true,
      name: '共養日誌常用選單',
      chatBarText: '常用功能',
      areas,
    }),
  });
  if (!createRes.ok) {
    console.error('建立失敗', createRes.status, await createRes.text());
    process.exit(1);
  }
  const { richMenuId } = await createRes.json();
  console.log('   richMenuId =', richMenuId);

  console.log('2/4 上傳圖片…');
  const imgBuf = fs.readFileSync(IMAGE_PATH);
  const contentType = IMAGE_PATH.endsWith('.jpg') || IMAGE_PATH.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
  const uploadRes = await fetch(`${DATA}/richmenu/${richMenuId}/content`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, Authorization: `Bearer ${TOKEN}` },
    body: imgBuf,
  });
  if (!uploadRes.ok) {
    console.error('上傳圖片失敗', uploadRes.status, await uploadRes.text());
    process.exit(1);
  }

  console.log('3/4 設成所有使用者的預設選單…');
  const defaultRes = await fetch(`${BASE}/user/all/richmenu/${richMenuId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!defaultRes.ok) {
    console.error('設定預設選單失敗', defaultRes.status, await defaultRes.text());
    process.exit(1);
  }

  console.log('4/4 完成 ✅ 打開任一個有這個官方帳號的聊天室，輸入框上方應該就會出現常駐選單列了。');
  console.log('   （如果沒馬上出現，把聊天室關掉重新打開，或稍等一下 LINE 端快取更新。）');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
