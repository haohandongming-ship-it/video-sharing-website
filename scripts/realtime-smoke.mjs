const apiBase = process.argv[2] ?? 'http://127.0.0.1:8080';
const wsUrl = apiBase.replace(/^http/, 'ws') + '/ws';

async function login(account) {
  const response = await fetch(`${apiBase}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ account, password: '123456', grantType: 'PASSWORD' }),
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) throw new Error(`登录失败：${JSON.stringify(payload)}`);
  return payload.data.accessToken;
}

function frame(command, headers = {}, body = '') {
  return `${command}\n${Object.entries(headers).map(([key, value]) => `${key}:${value}`).join('\n')}\n\n${body}\0`;
}

async function main() {
  const [userToken, adminToken] = await Promise.all([login('laowang'), login('admin')]);
  const socket = new WebSocket(wsUrl, ['v12.stomp']);
  const timeout = setTimeout(() => {
    socket.close();
    console.error('FAIL: 10 秒内未收到实时通知');
    process.exit(1);
  }, 10_000);

  socket.addEventListener('open', () => {
    socket.send(frame('CONNECT', {
      'accept-version': '1.2',
      host: 'localhost',
      Authorization: `Bearer ${userToken}`,
      'heart-beat': '0,0',
    }));
  });

  socket.addEventListener('message', async (event) => {
    const message = String(event.data);
    if (message.startsWith('CONNECTED')) {
      socket.send(frame('SUBSCRIBE', { id: 'notification-test', destination: '/user/queue/notifications', ack: 'auto' }));
      await new Promise((resolve) => setTimeout(resolve, 300));
      const response = await fetch(`${apiBase}/api/v1/messages/conversations/1/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ content: 'WebSocket 实时链路自动验证' }),
      });
      if (!response.ok) throw new Error(`发送触发消息失败：${response.status}`);
    } else if (message.startsWith('MESSAGE')) {
      const body = message.slice(message.indexOf('\n\n') + 2).replace(/\0$/, '');
      const notification = JSON.parse(body);
      if (notification.title !== '收到新私信') throw new Error(`通知载荷不正确：${body}`);
      clearTimeout(timeout);
      socket.send(frame('DISCONNECT', { receipt: 'done' }));
      socket.close();
      console.log(`PASS: STOMP 已收到通知 #${notification.id} ${notification.title}`);
    } else if (message.startsWith('ERROR')) {
      throw new Error(message);
    }
  });

  socket.addEventListener('error', () => {
    clearTimeout(timeout);
    throw new Error('WebSocket 连接失败');
  });
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exit(1);
});
