const express = require('express');
const { middleware, Client } = require('@line/bot-sdk');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const lineClient = new Client(lineConfig);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

app.post('/webhook', middleware(lineConfig), async (req, res) => {
  const events = req.body.events;
  await Promise.all(events.map(handleEvent));
  res.status(200).json({ status: 'ok' });
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;
  const userId = event.source.userId;
  const text = event.message.text.trim();
  await registerEmployee(userId);
  if (text === '研修' || text === 'メニュー' || text === 'menu') {
    return sendMenu(event.replyToken);
  } else if (text === '進捗') {
    return sendProgress(event.replyToken, userId);
  } else if (text === '修了証') {
    return sendCertificates(event.replyToken, userId);
  } else {
    return sendMenu(event.replyToken);
  }
}

async function registerEmployee(lineUserId) {
  const { data } = await supabase
    .from('employees')
    .select('id')
    .eq('line_user_id', lineUserId)
    .single();
  if (!data) {
    await supabase.from('employees').insert({
      name: '未設定',
      line_user_id: lineUserId,
    });
  }
}

async function sendMenu(replyToken) {
  await lineClient.replyMessage(replyToken, {
    type: 'template',
    altText: '研修メニュー',
    template: {
      type: 'buttons',
      title: '研修管理システム',
      text: 'メニューを選んでください',
      actions: [
        { type: 'message', label: '📚 研修コース一覧', text: 'コース一覧' },
        { type: 'message', label: '📊 自分の進捗確認', text: '進捗' },
        { type: 'message', label: '🏆 修了証を確認', text: '修了証' },
      ],
    },
  });
}

async function sendProgress(replyToken, lineUserId) {
  const { data: employee } = await supabase
    .from('employees')
    .select('id, name')
    .eq('line_user_id', lineUserId)
    .single();
  if (!employee) {
    return lineClient.replyMessage(replyToken, {
      type: 'text',
      text: '登録情報が見つかりません。「研修」と送ってメニューから開始してください。',
    });
  }
  const { data: courses } = await supabase.from('courses').select('*');
  const { data: progresses } = await supabase
    .from('progress')
    .select('*')
    .eq('employee_id', employee.id);
  let message = `【${employee.name}さんの進捗】\n\n`;
  for (const course of courses) {
    const p = progresses?.find(p => p.course_id === course.id);
    const status = !p ? '⬜ 未受講'
      : p.status === 'completed' ? `✅ 完了（${p.score}点）`
      : '🔄 受講中';
    message += `${course.title}\n${status}\n\n`;
  }
  return lineClient.replyMessage(replyToken, { type: 'text', text: message });
}

async function sendCertificates(replyToken, lineUserId) {
  const { data: employee } = await supabase
    .from('employees')
    .select('id, name')
    .eq('line_user_id', lineUserId)
    .single();
  const { data: completed } = await supabase
    .from('progress')
    .select('*, courses(title)')
    .eq('employee_id', employee.id)
    .eq('status', 'completed');
  if (!completed || completed.length === 0) {
    return lineClient.replyMessage(replyToken, {
      type: 'text',
      text: 'まだ修了した研修がありません。',
    });
  }
  let message = `【取得済み修了証】\n\n`;
  for (const c of completed) {
    message += `🏆 ${c.courses.title}\nスコア：${c.score}点\n\n`;
  }
  return lineClient.replyMessage(replyToken, { type: 'text', text: message });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`サーバー起動: ポート${PORT}`));
