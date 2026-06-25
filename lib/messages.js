// lib/messages.js
// LINE 訊息組裝。提醒按鈕一般化成任意任務；打卡確認附「誤觸取消」按鈕；
// 今日狀態與生命之書用 Flex 呈現。
import { fmtTaipeiHHMM } from './time.js';
import { KIND_META } from './db.js';

export const text = (t) => ({ type: 'text', text: t });

// 提醒卡（任意任務：餵藥 / 餵食 / 散步 / 自訂）
export function reminder(pet, task, slot, duty = null) {
  const meta = KIND_META[task.kind] || KIND_META.custom;
  const emoji = task.emoji || meta.emoji || '⏰';
  const dutyLine = duty ? `\n今天輪到 ${duty} 🙋` : '';
  return {
    type: 'template',
    altText: `該幫 ${pet.name} ${task.name} 了（${slot}）`,
    template: {
      type: 'buttons',
      text: `${emoji} 該幫 ${pet.name} ${task.name} 囉（${slot}）${dutyLine}\n完成就按一下，避免重複`,
      actions: [
        {
          type: 'postback',
          label: '我做好了 ✅',
          data: `a=done&t=${task.id}&s=${encodeURIComponent(slot)}&p=${pet.id}`,
          displayText: `${pet.name} ${task.name} 我做好了 ✅`,
        },
      ],
    },
  };
}

// 過時補提醒卡（超過設定時間還沒打卡時補一次）
export function overdueReminder(pet, task, slot, duty = null) {
  const meta = KIND_META[task.kind] || KIND_META.custom;
  const emoji = task.emoji || meta.emoji || '⏰';
  const dutyLine = duty ? `\n今天輪到 ${duty} 🙋` : '';
  return {
    type: 'template',
    altText: `${pet.name} 的 ${task.name}（${slot}）還沒完成`,
    template: {
      type: 'buttons',
      text: `⚠️ ${emoji} ${pet.name} 的 ${task.name}（${slot}）還沒有人打卡喔${dutyLine}\n做好了按一下`,
      actions: [
        {
          type: 'postback',
          label: '我做好了 ✅',
          data: `a=done&t=${task.id}&s=${encodeURIComponent(slot)}&p=${pet.id}`,
          displayText: `${pet.name} ${task.name} 我做好了 ✅`,
        },
      ],
    },
  };
}

// 通用「確認 / 取消」卡（刪除前先問，防誤刪）
export function confirmCard(question, confirmLabel, confirmData) {
  return {
    type: 'template',
    altText: question,
    template: {
      type: 'confirm',
      text: question.slice(0, 240),
      actions: [
        { type: 'postback', label: confirmLabel.slice(0, 20), data: confirmData, displayText: confirmLabel },
        { type: 'postback', label: '取消', data: 'a=noop', displayText: '取消' },
      ],
    },
  };
}

// 打卡成功 → 附一個「誤觸？取消這筆」按鈕（解掉需求 8）
export function doneConfirm(name, task, slot) {
  return {
    type: 'template',
    altText: `✅ ${name} 已完成 ${slot} 的 ${task.name}`,
    template: {
      type: 'buttons',
      text: `✅ ${name} 已完成 ${slot} 的 ${task.name}`,
      actions: [
        {
          type: 'postback',
          label: '誤觸？取消這筆',
          data: `a=undo&t=${task.id}&s=${encodeURIComponent(slot)}`,
          displayText: '取消這筆打卡',
        },
      ],
    },
  };
}

// 已經有人打過卡（時間用 DB 的 done_at 正確轉台北 —— 這就是舊版顯示錯時間的修正點）
export function alreadyDone(log, task, slot) {
  const who = log?.done_by_name || '家人';
  const at = fmtTaipeiHHMM(log?.done_at);
  return text(`這次（${slot}）已經由 ${who} 在 ${at} 做過囉，不用再來一次 🐾`);
}

// 今日狀態（需求 7）：每隻寵物列出每個任務每個時段的 ✅ / ⬜
export function todayStatus(pets, tasksByPet, logs, duty = null) {
  const doneSet = new Set(logs.map((l) => `${l.task_id}@${l.scheduled_time}`));
  const blocks = [];
  if (duty) {
    blocks.push({ type: 'text', text: `🙋 今天輪到 ${duty}`, size: 'sm', color: '#1DB446', weight: 'bold' });
  }
  for (const pet of pets) {
    const tasks = tasksByPet[pet.id] || [];
    blocks.push({ type: 'text', text: `🐾 ${pet.name}`, weight: 'bold', size: 'md', margin: 'md' });
    if (tasks.length === 0) {
      blocks.push({ type: 'text', text: '（尚未設定提醒）', size: 'sm', color: '#999999' });
      continue;
    }
    for (const t of tasks) {
      const meta = KIND_META[t.kind] || KIND_META.custom;
      for (const slot of t.times) {
        const done = doneSet.has(`${t.id}@${slot}`);
        blocks.push({
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: done ? '✅' : '⬜', flex: 0, size: 'sm' },
            {
              type: 'text',
              text: `${slot}  ${t.emoji || meta.emoji} ${t.name}`,
              size: 'sm',
              color: done ? '#999999' : '#333333',
              margin: 'sm',
            },
          ],
        });
      }
    }
  }
  return {
    type: 'flex',
    altText: '今天的照護狀態',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'xs',
        contents: [
          { type: 'text', text: '📋 今天的照護狀態', weight: 'bold', size: 'lg' },
          ...blocks,
        ],
      },
    },
  };
}

// 生命之書回顧（需求 6）：把最近的照片做成輪播，看得到照片本人
export function lifebookCarousel(pet, entries, urls) {
  const bubbles = entries
    .map((e, i) => {
      const url = urls[i];
      const date = fmtDate(e.created_at);
      const title = e.task_title || e.caption || '日常時光';
      if (url) {
        return {
          type: 'bubble',
          size: 'kilo',
          hero: { type: 'image', url, size: 'full', aspectRatio: '1:1', aspectMode: 'cover' },
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'xs',
            contents: [
              { type: 'text', text: title, weight: 'bold', size: 'sm', wrap: true },
              { type: 'text', text: `${date}・${e.by_name || ''}`, size: 'xs', color: '#999999' },
            ],
          },
        };
      }
      return {
        type: 'bubble',
        size: 'kilo',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: title, weight: 'bold', size: 'sm', wrap: true },
            { type: 'text', text: `${date}・${e.by_name || ''}`, size: 'xs', color: '#999999' },
          ],
        },
      };
    });
  return {
    type: 'flex',
    altText: `📖 ${pet.name} 的生命之書`,
    contents: { type: 'carousel', contents: bubbles },
  };
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: 'numeric',
    day: 'numeric',
  }).format(d);
  return p;
}

// 活動建議（依年齡/病況調整過的）
export function activitySuggestion(pet, act) {
  return text(
    `🐾 ${pet.name} 的今日小任務 ${act.note}\n\n` +
      `${act.title}\n${act.prompt}\n\n` +
      '完成後把照片傳進群組，就收進生命之書 📖'
  );
}

// 紀念模式啟動時的溫柔訊息
export function memorialMessage(pet, albumUrl) {
  const lines = [
    `🕊️ 已為 ${pet.name} 開啟紀念模式。`,
    `往後不會再傳 ${pet.name} 的提醒，但你們一起的時光都還在。`,
  ];
  if (albumUrl) lines.push(`\n隨時可以回來看看 ${pet.name} 的紀念冊：\n${albumUrl}`);
  lines.push('\n謝謝你們這樣好好愛過牠。');
  return text(lines.join('\n'));
}

// 月度回顧訊息（照片輪播 + 紀念冊連結）
export function recapMessages(pet, monthLabel, entries, urls, albumUrl) {
  const out = [text(`📖 ${pet.name} 的 ${monthLabel} 回顧，這個月一共留下 ${entries.length} 個時光 ✨`)];
  if (entries.length) out.push(lifebookCarousel(pet, entries, urls));
  if (albumUrl) out.push(text(`想看完整紀念冊（會自動播放）：\n${albumUrl}`));
  return out;
}

export function welcome() {
  return text(
    '嗨，我是共養日誌 🐾\n' +
      '我幫一家人一起照顧毛孩：提醒餵藥 / 餵食 / 散步、避免重複打卡，還會把你和牠的時光收進生命之書。\n\n' +
      '先輸入「新增寵物 哈吉」把毛孩加進來，\n' +
      '輸入「幫助」看所有指令。'
  );
}

export function help(wakeWord = '小幫手') {
  return text(
    '📖 共養日誌指令\n\n' +
      '【寵物（可多隻）】\n' +
      '新增寵物 哈吉\n' +
      '寵物清單\n' +
      '切換 哈吉 ← 之後指令預設這隻\n\n' +
      '【提醒（餵藥/餵食/散步/自訂）】\n' +
      '新增用藥 腎臟藥 08:00,20:00\n' +
      '新增餵食 早餐 07:00\n' +
      '新增散步 19:00\n' +
      '新增提醒 點眼藥 09:00,21:00\n' +
      '（多隻時可加寵物名：新增餵食 哈吉 早餐 07:00）\n' +
      '提醒清單 / 刪除提醒 早餐\n\n' +
      '【每天】\n' +
      '到時間我會推提醒，做好按「我做好了 ✅」，系統擋重複。\n' +
      '今天 ← 看今天每件事做了沒\n' +
      '取消 早餐 07:00 ← 刪掉誤觸的打卡\n\n' +
      '【生命之書】\n' +
      '回顧 ← 看最近的照片時光\n' +
      '紀念冊 ← 可保存、會自動播放的紀念冊\n' +
      '任務 ← 依年齡/病況給個互動小任務\n' +
      '紀念 旺旺 ← 為離世的毛孩開啟紀念模式\n' +
      '把照片傳進群組 → 自動收藏\n\n' +
      '【輪值 / 補提醒】\n' +
      '輪值 爸 媽 我 ← 每天輪一位\n' +
      '過時提醒 30 ← 超過30分沒打卡補提醒（關閉過時提醒）\n\n' +
      `【AI 助手】用「${wakeWord} …」直接講，例如：\n` +
      `・${wakeWord} 幫哈吉設定每天中午12點吃心絲蟲藥\n` +
      `・${wakeWord} 把早餐改成 8 點 / 晚點30分鐘再提醒我散步\n` +
      `・${wakeWord} 回顧哈吉的照片 / 今天還有什麼沒做`
  );
}
