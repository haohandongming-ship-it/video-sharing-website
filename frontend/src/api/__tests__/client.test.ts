import { afterEach, describe, expect, it, vi } from 'vitest';
import { http } from '../client';
import { authBridge } from '../authBridge';
import { uploadApi } from '../uploads';

vi.mock('../config', async (original) => ({
  ...await original<typeof import('../config')>(), USE_MOCK: false,
}));

afterEach(() => { vi.unstubAllGlobals(); authBridge.clear(); });

describe('真实 HTTP 错误处理', () => {
  it('对象存储直传只使用签名地址，不泄露平台登录凭证并保留真实 ETag', async () => {
    authBridge.setSession('private-platform-token', null);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { ETag: 'real-etag' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(uploadApi.putPart('https://storage.example/test?signature=abc', new Blob(['test'])))
      .resolves.toBe('real-etag');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
    expect(init.credentials).toBe('omit');
  });
  it.each([
    new Response(null, { status: 403 }),
    new Response('<html>Bad Gateway</html>', { status: 502 }),
    new Response(JSON.stringify({ message: '服务不可用' }), { status: 503 }),
    new Response(JSON.stringify({ code: 0, data: {} }), { status: 500 }),
  ])('非成功 HTTP 状态必须拒绝，即使响应没有业务错误码', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(http.get('/api/v1/videos')).rejects.toMatchObject({ status: response.status });
  });

  it('刷新后的重试仍返回 401 时不能被当作成功', async () => {
    authBridge.setSession('expired-token', null);
    authBridge.onRefresh(async () => 'new-token');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(null, { status: 401 })));
    await expect(http.get('/api/v1/users/me', { auth: true })).rejects.toMatchObject({ status: 401 });
  });
});
