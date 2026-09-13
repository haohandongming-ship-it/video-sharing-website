import { http } from './client';
import type {
  AuthSession,
  LoginByPasswordPayload,
  LoginBySmsPayload,
  RegisterPayload,
  UserProfile,
} from './types';

export const authApi = {
  /** 手机号 + 验证码登录（文档 3.1 主路径） */
  loginBySms: (payload: LoginBySmsPayload) =>
    http.post<AuthSession>('/api/v1/auth/login', { ...payload, grantType: 'SMS' }),

  loginByPassword: (payload: LoginByPasswordPayload) =>
    http.post<AuthSession>('/api/v1/auth/login', { ...payload, grantType: 'PASSWORD' }),

  register: (payload: RegisterPayload) => http.post<AuthSession>('/api/v1/auth/register', payload),

  resetPassword: (payload: { phone: string; code: string; password: string }) =>
    http.post<{ success: boolean }>('/api/v1/auth/password/reset', payload),

  /** 发送短信验证码（服务端有防轰炸限额，见 13.3） */
  sendSmsCode: (phone: string, captchaToken?: string) =>
    http.post<{ sent: boolean; expiresIn: number; mockCode?: string }>('/api/v1/auth/sms-code', {
      phone,
      captchaToken,
    }),

  getCaptcha: () =>
    http.get<{ captchaId: string; imageUrl: string; question: string }>('/api/v1/auth/captcha'),

  /** 静默刷新：Refresh Token 走 httpOnly Cookie */
  refresh: () => http.post<AuthSession>('/api/v1/auth/refresh'),

  logout: () => http.post<{ success: boolean }>('/api/v1/auth/logout'),

  oauthAuthorizeUrl: (provider: 'wechat' | 'qq') =>
    http.get<{ url: string; state: string }>('/api/v1/auth/oauth/authorize-url', { query: { provider } }),

  me: () => http.get<UserProfile>('/api/v1/users/me', { auth: true }),

  updateProfile: (payload: Partial<Pick<UserProfile, 'nickname' | 'bio' | 'avatar'>>) =>
    http.put<UserProfile>('/api/v1/users/me', payload, { auth: true }),

  changePassword: (oldPassword: string, newPassword: string) =>
    http.put<{ success: boolean }>('/api/v1/users/me/password', { oldPassword, newPassword }, { auth: true }),

  submitRealName: (payload: { realName: string; idCard: string; phone: string }) =>
    http.post<{ status: string }>('/api/v1/users/me/real-name', payload, { auth: true, idempotent: true }),

  /** 账号注销：7 天冷静期（文档 3.1 / 14.4） */
  requestDeactivate: (reason?: string) =>
    http.post<{ scheduledAt: string; coolDownDays: number }>(
      '/api/v1/users/me/deactivate',
      { reason },
      { auth: true, idempotent: true },
    ),
};
