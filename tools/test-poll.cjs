// Standalone test: poll sync_msg and reply
const CORP_ID = process.env.WECHAT_CORP_ID || 'YOUR_CORP_ID';
const SECRET = process.env.WECHAT_APP_SECRET || 'YOUR_APP_SECRET';
const OPEN_KFID = process.env.WECHAT_OPEN_KFID || 'YOUR_OPEN_KFID';

async function getToken() {
  const r = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${CORP_ID}&corpsecret=${SECRET}`);
  const d = await r.json();
  if (d.errcode !== 0) throw new Error(`gettoken: ${d.errcode} ${d.errmsg}`);
  return d.access_token;
}

async function syncMsg(token, cursor) {
  const body = { open_kfid: OPEN_KFID, limit: 10 };
  if (cursor) body.cursor = cursor;
  const r = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg?access_token=${token}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return r.json();
}

async function sendMsg(token, toUser, text) {
  const r = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/kf/send_msg?access_token=${token}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ touser: toUser, open_kfid: OPEN_KFID, msgtype: 'text', text: { content: text } })
  });
  return r.json();
}

(async () => {
  const token = await getToken();
  console.log('Token OK');
  
  // First sync to get cursor
  const first = await syncMsg(token, null);
  console.log('First sync:', JSON.stringify(first, null, 2));
  
  const cursor = first.next_cursor;
  console.log('Cursor:', cursor);
  
  // Find customer messages (origin=3)
  const customerMsgs = (first.msg_list || []).filter(m => m.origin === 3 && m.msgtype === 'text');
  console.log(`Found ${customerMsgs.length} customer text messages`);
  
  if (customerMsgs.length > 0) {
    const lastMsg = customerMsgs[customerMsgs.length - 1];
    console.log(`Last message: "${lastMsg.text.content}" from ${lastMsg.external_userid}`);
    
    // Reply
    const reply = await sendMsg(token, lastMsg.external_userid, `苗苗收到你的「${lastMsg.text.content}」啦！这是通过 OpenClaw 插件自动回复的 🔥`);
    console.log('Reply result:', JSON.stringify(reply));
  }
})();
