// lib/messages.js
// LINE 訊息組裝。提醒按鈕一般化成任意任務；打卡確認附「誤觸取消」按鈕；
// 今日狀態與生命之書用 Flex 呈現。
import { fmtTaipeiHHMM } from './time.js';
import { KIND_META } from './db.js';
import { COLLECTIONS, QUICK_PICK, getCollection } from './collections.js';
import { ROLE_LABEL } from './perms.js';

export const text = (t) => ({ type: 'text', text: t });

// 提醒卡（任意任務：餵藥 / 餵食 / 散步 / 自訂）
export function reminder(pet, task, slot, duty = null) {
  const meta = KIND_META[task.kind] || KIND_META.custom;
  const emoji = task.emoji || meta.emoji || '⏰';
  const doseLine = task.dosage ? `\n劑量：${task.dosage}` : '';
  const dutyLine = duty ? `\n今天輪到 ${duty} 🙋` : '';
  return {
    type: 'template',
    altText: `該幫 ${pet.name} ${task.name} 了（${slot}）`,
    template: {
      type: 'buttons',
      text: `${emoji} 該幫 ${pet.name} ${task.name} 囉（${slot}）${doseLine}${dutyLine}\n完成就按一下，避免重複`,
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

// 過時補提醒卡（超過設定時間還沒打卡時補一次）—— 升級成「指名今天輪值的人」
export function overdueReminder(pet, task, slot, duty = null) {
  const meta = KIND_META[task.kind] || KIND_META.custom;
  const emoji = task.emoji || meta.emoji || '⏰';
  const doseLine = task.dosage ? `\n劑量：${task.dosage}` : '';
  const head = duty
    ? `⚠️ ${duty}，${pet.name} 的 ${task.name}（${slot}）還沒人完成，今天輪到你囉 🙋`
    : `⚠️ ${emoji} ${pet.name} 的 ${task.name}（${slot}）還沒有人打卡喔`;
  const tail = duty ? '\n做好了按一下；不方便的話也提醒一下其他家人' : '\n誰有空的話幫忙按一下';
  return {
    type: 'template',
    altText: `${pet.name} 的 ${task.name}（${slot}）還沒完成`,
    template: {
      type: 'buttons',
      text: `${head}${doseLine}${tail}`,
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

// 活動建議（依狀態調整語氣；安寧/紀念用最輕柔的講法，且永遠不放慶祝符號）
export function activitySuggestion(pet, act, weekly = false) {
  if (!act) return text(`現在先好好陪 ${pet.name} 就好 🤍`);
  const tag = weekly ? '本週小任務' : '今日小任務';
  const head =
    act.voice === 'quiet'
      ? `🤍 ${pet.name} 的${tag}`
      : `🐾 ${pet.name} 的${tag} ${act.note || ''}`;
  const tail =
    act.voice === 'quiet'
      ? '不勉強，有拍到就傳進群組，我會輕輕收進生命之書 📖'
      : '完成後把照片傳進群組，就收進生命之書 📖';
  return text(`${head}\n\n${act.title}\n${act.prompt}\n\n${tail}`);
}

// 每週自動推送的小任務（語氣同上，只是換成「本週」框架）
export const weeklyTask = (pet, act) => activitySuggestion(pet, act, true);

// 收到照片後，問要不要順手歸到某本圖鑑（LINE 快速回覆按鈕）
export function photoSaved(pet, entry) {
  const items = QUICK_PICK.map((key) => {
    const c = getCollection(key);
    return {
      type: 'action',
      action: {
        type: 'postback',
        label: `${c.emoji} ${c.title}`.slice(0, 20),
        data: `a=file&e=${entry.id}&c=${key}`,
        displayText: `收進${c.title}`,
      },
    };
  });
  items.push({
    type: 'action',
    action: { type: 'postback', label: '先不分類', data: 'a=noop', displayText: '先不分類' },
  });
  return {
    type: 'text',
    text: `這一刻收進 ${pet.name} 的生命之書了 📖\n要順手收進哪本圖鑑嗎？`,
    quickReply: { items },
  };
}

// 歸檔完成 + 進度。集滿時的慶祝受 celebrate 守門（安寧/紀念一律不慶祝）。
export function collectionFiled(col, n, celebrate = 'on') {
  const bar = `${n}/${col.target}`;
  if (n >= col.target && celebrate === 'on') {
    return text(`🎉 ${col.emoji}「${col.title}」集滿了！(${bar})\n你們一起完成了一整本，太棒了！`);
  }
  return text(`已收進「${col.emoji} ${col.title}」(${bar}) 📚`);
}

// 圖鑑進度總覽
export function collectionsList(pet, counts) {
  const lines = [`📚 ${pet.name} 的圖鑑進度`];
  for (const c of COLLECTIONS) lines.push(`${c.emoji} ${c.title}　${counts[c.key] || 0}/${c.target}`);
  lines.push('\n把照片傳進群組就能繼續收集 🐾');
  return text(lines.join('\n'));
}

// 進入安寧期的溫柔確認（不冷冰冰宣告）
export function hospiceMessage(pet) {
  return text(
    `🤍 好，我會把 ${pet.name} 切到最輕柔的陪伴步調。\n` +
      `藥物提醒會照常（該顧的還是要顧），但我不會再丟活動任務、也不會有任何慶祝動畫。\n` +
      `如果牠好轉了，隨時跟我說「恢復照護 ${pet.name}」。\n` +
      `這段時間，好好陪牠。`
  );
}
export function restoreMessage(pet) {
  return text(`好，${pet.name} 回到日常照護的步調了 🐾`);
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
      '圖鑑 ← 看各系列（睡姿/表情包…）收集進度\n' +
      '紀念冊 ← 可保存、會自動播放的紀念冊\n' +
      '任務 ← 依年齡/病況給個互動小任務（每週六也會自動丟一個）\n' +
      '安寧 哈吉 / 恢復照護 哈吉 ← 切換安寧期（藥提醒照常、停任務與慶祝）\n' +
      '紀念 旺旺 ← 為離世的毛孩開啟紀念模式\n' +
      '把照片傳進群組 → 自動收藏，還能順手收進某本圖鑑\n\n' +
      '【輪值 / 補提醒】\n' +
      '輪值 爸 媽 我 ← 每天輪一位\n' +
      '過時提醒 30 ← 超過30分沒打卡補提醒（關閉過時提醒）\n\n' +
      `【AI 助手】用「${wakeWord} …」直接講，例如：\n` +
      `・${wakeWord} 幫哈吉設定每天中午12點吃心絲蟲藥 每次半顆\n` +
      `・${wakeWord} 把早餐改成 8 點 / 晚點30分鐘再提醒我散步\n` +
      `・${wakeWord} 回顧哈吉的照片 / 哈吉的圖鑑收集到哪了`
  );
}

// ===================== Phase 1 #1：角色權限的訊息 =====================

export function noPermManage() {
  return text(
    '這個動作需要「主飼主」權限喔 🔒\n' +
      '請主飼主用「設定 你的名字 為 主飼主」幫你開通，\n' +
      '或先「停用權限」回到大家都能操作的模式。'
  );
}
export function noPermCheckin() {
  return text('你目前是「唯讀」成員，看得到但不能操作喔。需要的話請主飼主把你設成「照顧者」。');
}

export function rolesEnabled(name) {
  return text(
    `🔐 好，已啟用角色權限，${name} 是主飼主。\n` +
      '從現在起：\n' +
      '・主飼主：可改排程、刪除、設角色\n' +
      '・照顧者：可打卡、傳照片、記健康\n' +
      '・唯讀：只能看\n\n' +
      '指派角色：「設定 媽媽 為 照顧者」（對方要先在群裡說過話）\n' +
      '看成員：「成員」　關閉：「停用權限」'
  );
}

export function membersList(group, members) {
  const enabled = group?.roles_enabled;
  const lines = [`👥 照護圈成員（角色${enabled ? '已啟用' : '未啟用，目前大家都能操作'}）`];
  if (!members.length) lines.push('（還沒記到任何人，先在群裡互動一下我就會記得）');
  for (const m of members) lines.push(`・${m.display_name || '某位家人'} — ${ROLE_LABEL[m.role] || m.role}`);
  if (!enabled) lines.push('\n任何人都可「我是主飼主」開啟角色管理。');
  else lines.push('\n指派：「設定 名字 為 主飼主/照顧者/唯讀」');
  return text(lines.join('\n'));
}

// ===================== Phase 3 #3：健康紀錄 =====================
const HEALTH_META = {
  weight: { e: '⚖️', l: '體重' },
  appetite: { e: '🍽️', l: '食慾' },
  symptom: { e: '🩺', l: '症狀' },
  note: { e: '📝', l: '備註' },
};

export function healthLogged(pet, kind, { num = null, valueText = null, prevNum = null } = {}) {
  const meta = HEALTH_META[kind] || HEALTH_META.note;
  if (kind === 'weight') {
    let delta = '';
    if (prevNum != null) {
      const d = Math.round((num - prevNum) * 100) / 100;
      if (d === 0) delta = '（跟上次一樣）';
      else delta = `（比上次 ${d > 0 ? '＋' : '－'}${Math.abs(d)}kg）`;
    }
    return text(`⚖️ 記下了：${pet.name} 體重 ${num}kg ${delta}`);
  }
  return text(`${meta.e} 記下了：${pet.name} 的${meta.l}「${valueText}」`);
}

export function healthTimeline(pet, logs, weights) {
  const lines = [`🩺 ${pet.name} 的健康紀錄`];
  if (weights && weights.length >= 2) {
    const latest = weights[0];
    const oldest = weights[weights.length - 1];
    const d = Math.round((latest.value_num - oldest.value_num) * 100) / 100;
    const trend = d > 0 ? `↑${d}` : d < 0 ? `↓${Math.abs(d)}` : '持平';
    lines.push(`體重趨勢：${oldest.value_num} → ${latest.value_num}kg（${trend}）`);
  }
  if (!logs.length) lines.push('（還沒有任何紀錄。試試「體重 ' + pet.name + ' 5.2」或「症狀 ' + pet.name + ' 食慾不佳」）');
  else {
    lines.push('—— 最近 ——');
    for (const g of logs) {
      const meta = HEALTH_META[g.kind] || HEALTH_META.note;
      const v = g.kind === 'weight' ? `${g.value_num}kg` : g.value_text || '';
      lines.push(`${fmtDate(g.created_at)} ${meta.e}${meta.l} ${v}${g.by_name ? `・${g.by_name}` : ''}`);
    }
  }
  return text(lines.join('\n'));
}

// ===================== #4：一鍵交接卡（保母/獸醫用） =====================
export function handoverCard(pet, { ageText, tasks = [], todayLines = [], latestWeight = null, recentHealth = [] }) {
  const lines = [`📋 ${pet.name} 的照護交接卡`, ''];
  const basic = [pet.species || '毛孩'];
  if (ageText) basic.push(`約 ${ageText}`);
  lines.push(`🐾 基本：${basic.join('，')}`);
  if (pet.health) lines.push(`　狀況：${pet.health}`);

  lines.push('', '⏰ 每日提醒：');
  if (!tasks.length) lines.push('　（無）');
  for (const t of tasks) {
    const meta = KIND_META[t.kind] || KIND_META.custom;
    const dose = t.dosage ? `（${t.dosage}）` : '';
    lines.push(`　${t.emoji || meta.emoji} ${t.name}${dose}：${t.times.join('、')}`);
  }

  lines.push('', '📍 今天進度：');
  if (!todayLines.length) lines.push('　今天沒有排定的提醒');
  for (const l of todayLines) lines.push(`　${l}`);

  if (latestWeight) lines.push('', `⚖️ 最近體重：${latestWeight.value_num}kg（${fmtDate(latestWeight.created_at)}）`);
  if (recentHealth.length) {
    lines.push('', '🩺 最近狀況：');
    for (const h of recentHealth) lines.push(`　${fmtDate(h.created_at)} ${h.value_text || ''}`);
  }
  lines.push('', '有狀況請聯絡主飼主 🙏');
  return text(lines.join('\n'));
}

// ===================== #2：聊天室內「教學」（比「幫助」更短、引導式） =====================
export function teaching(wakeWord = '小幫手') {
  return text(
    '🐾 三步驟上手共養日誌\n\n' +
      '① 加毛孩\n　「新增寵物 哈吉」\n\n' +
      '② 設提醒（到點我會在群裡提醒，做好按「我做好了 ✅」，系統自動擋重複給藥）\n' +
      `　「新增用藥 腎臟藥 08:00,20:00」\n　或直接跟我說：「${wakeWord} 幫哈吉早晚各一次餵腎臟藥，每次半顆」\n\n` +
      '③ 留下回憶\n　把照片傳進群組 → 自動收進生命之書，還能選收進圖鑑 📖\n\n' +
      '其他好用的：\n' +
      '・「今天」看大家做了沒　・「體重 哈吉 5.2」記健康\n' +
      '・「交接卡 哈吉」給保母/獸醫的摘要\n' +
      '・「輪值 爸 媽 我」每天輪一位\n\n' +
      '完整指令打「幫助」；想分權限打「我是主飼主」。'
  );
}
