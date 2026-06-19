// 各種 LINE 訊息的組裝。用 buttons template 與 quickReply,避免 Flex 的複雜度。

function reminder(petName, medName, time, medId) {
  const name = petName || '毛孩';
  return {
    type: 'template',
    altText: `該幫${name}餵藥了（${time}）`,
    template: {
      type: 'buttons',
      text: `⏰ 該幫${name}餵藥囉\n${medName}（${time}）\n餵好就按一下,避免重複給藥`,
      actions: [
        {
          type: 'postback',
          label: '我餵了 ✅',
          data: `action=med_done&medId=${encodeURIComponent(medId)}&time=${encodeURIComponent(time)}`,
          displayText: '我餵了 ✅',
        },
      ],
    },
  };
}

function task(t, difficulty, petName) {
  const name = petName || '毛孩';
  return {
    type: 'text',
    text:
      `🐾 ${name}的任務（${difficulty}）\n\n` +
      `${t.title}\n${t.prompt}\n\n` +
      `完成後拍張照傳進這個群,我就幫你收進生命之書 📖`,
    quickReply: {
      items: [
        { type: 'action', action: { type: 'postback', label: '換一個', data: 'action=new_task', displayText: '換一個任務' } },
        { type: 'action', action: { type: 'message', label: '簡單', text: '任務 簡單' } },
        { type: 'action', action: { type: 'message', label: '中等', text: '任務 中等' } },
        { type: 'action', action: { type: 'message', label: '困難', text: '任務 困難' } },
      ],
    },
  };
}

function text(t) {
  return { type: 'text', text: t };
}

function welcome() {
  return text(
    '嗨,我是共養日誌 🐾\n' +
      '我能幫你們一起照顧毛孩、提醒餵藥、避免重複給藥,還會三不五時出個小任務,把你和牠的時光收進「生命之書」。\n\n' +
      '先輸入「綁定 你家毛孩的名字」開始吧!\n' +
      '輸入「幫助」可以看所有指令。'
  );
}

function help() {
  return text(
    '📖 共養日誌指令\n\n' +
      '【基本設定】\n' +
      '綁定 咪咪 ← 設定毛孩名字\n' +
      '新增用藥 腎臟藥 08:00,20:00 ← 設定餵藥時間\n' +
      '用藥清單 ← 看目前的用藥\n' +
      '設定 ← 看目前所有設定\n\n' +
      '【餵藥】\n' +
      '到時間我會自動提醒,餵好按「我餵了 ✅」即可,系統會擋掉重複給藥。\n\n' +
      '【生命之書任務】\n' +
      '任務 ← 立刻來一個任務\n' +
      '任務 簡單 / 任務 困難 ← 指定難度\n' +
      '難度 簡單 ← 設定自動任務的預設難度\n' +
      '頻率 3 ← 每幾天自動出一個任務\n' +
      '生命之書 ← 看收藏的時光\n\n' +
      '任務完成後,把照片傳進群組,我就幫你收進生命之書。'
  );
}

module.exports = { reminder, task, text, welcome, help };
