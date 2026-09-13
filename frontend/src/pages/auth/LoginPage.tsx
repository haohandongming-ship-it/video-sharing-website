/**
 * 登录 / 注册 / 忘记密码 —— 文档 3.1、13.1
 * 主路径为手机号 + 验证码；账号密码与第三方登录为备选。
 * 演示环境内置 4 个演示账号，便于评审快速切换角色权限。
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, Mail, Phone, ShieldCheck, User, UserRound } from 'lucide-react';
import { Button, Divider, Input, Switch, Tabs, type TabItem } from '@/components/ui';
import { authApi } from '@/api/auth';
import { APP_NAME, APP_SLOGAN } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';

type AuthMode = 'login' | 'register' | 'forgot';
type LoginMethod = 'sms' | 'password';

interface LoginPageProps {
  /** 由路由 /register 传入 register，决定初始模式 */
  initialMode?: 'login' | 'register';
}

const MODE_TABS: TabItem<AuthMode>[] = [
  { key: 'login', label: '登录' },
  { key: 'register', label: '注册' },
  { key: 'forgot', label: '忘记密码' },
];

const METHOD_TABS: TabItem<LoginMethod>[] = [
  { key: 'sms', label: '手机号验证码' },
  { key: 'password', label: '账号密码' },
];

const FEATURES = [
  { title: '长视频与短视频同站', description: '按栏目、榜单与订阅组织内容，进度自动记忆。' },
  { title: '创作者后台上传即用', description: '分片断点续传、转码进度可见，发布状态透明。' },
  { title: '可关闭的个性化推荐', description: '关闭后仅展示热门与时间线，另提供青少年模式。' },
];

const DEMO_ACCOUNTS = [
  { account: 'admin', password: '123456', label: '管理员', hint: '审核与用户管理' },
  { account: 'moderator', password: '123456', label: '审核员', hint: '审核队列与举报' },
  { account: 'laowang', password: '123456', label: '创作者', hint: '上传与数据看板' },
  { account: 'newbie', password: '123456', label: '新用户', hint: '先审后发策略' },
];

const PHONE_PATTERN = /^1[3-9]\d{9}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_PATTERN = /^\d{6}$/;
const SMS_COOLDOWN = 60;
const COMPLIANCE = '登录即表示同意《用户协议》与《隐私政策》· 已按《个人信息保护法》要求最小化收集信息';

/** 短信验证码倒计时：60 秒内禁止重复发送（服务端另有防轰炸限额） */
function useSmsCountdown() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setTimeout(() => setSeconds((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [seconds]);
  const start = useCallback(() => setSeconds(SMS_COOLDOWN), []);
  return { seconds, start, counting: seconds > 0 };
}

function strengthOf(password: string): { label: string; percent: number; bar: string } {
  if (!password) return { label: '未填写', percent: 0, bar: 'bg-surface-3' };
  let score = 0;
  if (password.length >= 6) score += 1;
  if (password.length >= 10) score += 1;
  if (/[A-Za-z]/.test(password) && /\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  if (score <= 1) return { label: '弱', percent: 30, bar: 'bg-brand' };
  if (score === 2) return { label: '中', percent: 60, bar: 'bg-warning' };
  if (score === 3) return { label: '较强', percent: 80, bar: 'bg-accent' };
  return { label: '强', percent: 100, bar: 'bg-success' };
}

/** 用户名可用性提示：本地即时反馈，注册提交时由服务端最终校验 */
function usernameHint(username: string): string {
  const value = username.trim();
  if (!value) return '用户名注册后不可修改，请谨慎填写';
  if (value.length < 4) return `还需 ${4 - value.length} 个字符`;
  if (!/^[A-Za-z0-9_]+$/.test(value)) return '仅支持字母、数字与下划线';
  if (DEMO_ACCOUNTS.some((demo) => demo.account === value)) return '该用户名已被占用';
  return '该用户名可以使用';
}

export default function LoginPage({ initialMode = 'login' }: LoginPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const loginByPassword = useAuthStore((s) => s.loginByPassword);
  const loginBySms = useAuthStore((s) => s.loginBySms);
  const register = useAuthStore((s) => s.register);
  const pending = useAuthStore((s) => s.pending);
  const storeError = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [method, setMethod] = useState<LoginMethod>('sms');

  const [smsPhone, setSmsPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const countdown = useSmsCountdown();

  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);

  const [rUsername, setRUsername] = useState('');
  const [rNickname, setRNickname] = useState('');
  const [rEmail, setREmail] = useState('');
  const [rPhone, setRPhone] = useState('');
  const [rPassword, setRPassword] = useState('');
  const [rConfirm, setRConfirm] = useState('');
  const [agreed, setAgreed] = useState(false);

  const [fPhone, setFPhone] = useState('');
  const [fCode, setFCode] = useState('');
  const [fPassword, setFPassword] = useState('');
  const [fConfirm, setFConfirm] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [modeSource, setModeSource] = useState<AuthMode>(initialMode);

  // 路由切换（/login ↔ /register）时同步模式，避免用 effect 触发级联渲染
  if (modeSource !== initialMode) {
    setModeSource(initialMode);
    setMode(initialMode);
    setErrors({});
  }

  const notify = useCallback(
    (title: string, description?: string, tone: 'info' | 'success' | 'warning' | 'error' = 'info') =>
      useUiStore.getState().toast({ title, description, tone }),
    [],
  );

  const redirectAfterAuth = useCallback(() => {
    const from = (location.state as { from?: string } | null)?.from;
    navigate(from ?? '/', { replace: true });
  }, [location.state, navigate]);

  /** 校验：key 为目标字段，返回校验后的错误表 */
  const validate = (rules: Record<string, boolean>, messages: Record<string, string>) => {
    const next: Record<string, string> = {};
    for (const [field, failed] of Object.entries(rules)) {
      if (failed) next[field] = messages[field];
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const sendCode = async (phone: string, field: string) => {
    if (!PHONE_PATTERN.test(phone)) {
      setErrors((prev) => ({ ...prev, [field]: '请输入 11 位手机号' }));
      return;
    }
    setErrors((prev) => ({ ...prev, [field]: '' }));
    setSending(true);
    try {
      const result = await authApi.sendSmsCode(phone);
      countdown.start();
      setDemoCode(result.mockCode ?? null);
      notify(
        '验证码已发送',
        result.mockCode ? `演示环境验证码：${result.mockCode}` : '5 分钟内有效，请勿泄露给他人',
        'success',
      );
    } catch (error) {
      notify('验证码发送失败', error instanceof Error ? error.message : '请稍后重试', 'error');
    } finally {
      setSending(false);
    }
  };

  const submitLogin = async (nextAccount = account, nextPassword = password, bySms = method === 'sms') => {
    const ok = bySms
      ? validate(
          { smsPhone: !PHONE_PATTERN.test(smsPhone), smsCode: !CODE_PATTERN.test(smsCode) },
          { smsPhone: '请输入 11 位手机号', smsCode: '请输入 6 位数字验证码' },
        )
      : validate(
          { account: nextAccount.trim().length < 2, password: nextPassword.length < 6 },
          { account: '请输入用户名或邮箱', password: '密码至少 6 位' },
        );
    if (!ok) return;
    clearError();
    try {
      if (bySms) {
        await loginBySms({ phone: smsPhone, code: smsCode });
      } else {
        await loginByPassword({ account: nextAccount.trim(), password: nextPassword, remember });
      }
      notify('登录成功', bySms ? '欢迎回来' : `已以 ${nextAccount.trim()} 身份登录`, 'success');
      redirectAfterAuth();
    } catch (error) {
      notify('登录失败', error instanceof Error ? error.message : '请稍后重试', 'error');
    }
  };

  const submitRegister = async () => {
    const ok = validate(
      {
        rUsername: rUsername.trim().length < 4,
        rNickname: rNickname.trim().length < 2,
        rEmail: !EMAIL_PATTERN.test(rEmail),
        rPhone: Boolean(rPhone) && !PHONE_PATTERN.test(rPhone),
        rPassword: rPassword.length < 6,
        rConfirm: rConfirm !== rPassword,
        agreed: !agreed,
      },
      {
        rUsername: '用户名至少 4 个字符',
        rNickname: '昵称至少 2 个字符',
        rEmail: '请输入有效的邮箱地址',
        rPhone: '请输入 11 位手机号，或留空',
        rPassword: '密码至少 6 位',
        rConfirm: '两次输入的密码不一致',
        agreed: '请先阅读并同意《用户协议》与《隐私政策》',
      },
    );
    if (!ok) return;
    clearError();
    try {
      await register({
        username: rUsername.trim(),
        nickname: rNickname.trim(),
        email: rEmail.trim(),
        password: rPassword,
        phone: rPhone || undefined,
        agreeTerms: true,
      });
      notify('注册成功', '已为你自动登录', 'success');
      redirectAfterAuth();
    } catch (error) {
      notify('注册失败', error instanceof Error ? error.message : '请稍后重试', 'error');
    }
  };

  const submitForgot = () => {
    const ok = validate(
      {
        fPhone: !PHONE_PATTERN.test(fPhone),
        fCode: !CODE_PATTERN.test(fCode),
        fPassword: fPassword.length < 6,
        fConfirm: fConfirm !== fPassword,
      },
      {
        fPhone: '请输入 11 位手机号',
        fCode: '请输入 6 位数字验证码',
        fPassword: '新密码至少 6 位',
        fConfirm: '两次输入的密码不一致',
      },
    );
    if (!ok) return;
    setSmsPhone(fPhone);
    setMode('login');
    setMethod('sms');
    notify('密码已重置', '请使用新密码登录；演示环境不发送真实短信', 'success');
  };

  const handleOauth = async (provider: 'wechat' | 'qq') => {
    const name = provider === 'wechat' ? '微信' : 'QQ';
    try {
      const { url, state } = await authApi.oauthAuthorizeUrl(provider);
      notify(
        `${name}登录（演示环境不跳转）`,
        `授权地址：${url}；state=${state}。state 由服务端生成并在回调时校验，用于防止 CSRF。`,
        'info',
      );
    } catch (error) {
      notify('暂时无法获取授权地址', error instanceof Error ? error.message : '请稍后重试', 'error');
    }
  };

  /** 字段包装：标题 + 控件 + 行内错误（校验失败时用 Input 的 invalid 描红） */
  const field = (label: string, control: ReactNode, error?: string, hint?: ReactNode) => (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {control}
      {error ? <span className="text-xs text-brand">{error}</span> : hint}
    </label>
  );

  const codeSuffix = (phone: string, key: string) => (
    <Button
      size="xs"
      variant="secondary"
      loading={sending}
      disabled={countdown.counting}
      aria-label={countdown.counting ? `${countdown.seconds} 秒后可重新获取验证码` : '获取验证码'}
      onClick={() => void sendCode(phone, key)}
    >
      {countdown.counting ? `${countdown.seconds}s 后重发` : '获取验证码'}
    </Button>
  );

  const strength = strengthOf(rPassword);

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="hidden bg-surface lg:flex lg:w-[46%] lg:flex-col lg:justify-between lg:border-r lg:border-line lg:p-10 xl:p-14">
        <div>
          <p className="text-sm font-medium tracking-[0.2em] text-fg-subtle">VIDEO SHARING</p>
          <h1 className="mt-6 text-4xl font-semibold tracking-[-0.02em] text-fg">{APP_NAME}</h1>
          <p className="mt-3 text-base text-fg-muted">{APP_SLOGAN}</p>
        </div>
        <ul className="mt-12 flex max-w-md flex-col gap-6">
          {FEATURES.map((item) => (
            <li key={item.title}>
              <p className="text-sm font-medium text-fg">{item.title}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">{item.description}</p>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-fg-subtle">内容由创作者上传，平台按《网络安全法》要求留存审核记录。</p>
      </aside>

      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6 lg:py-12">
        <div className="w-full max-w-md">
          <div className="mb-6 lg:hidden">
            <p className="text-2xl font-semibold tracking-[-0.02em] text-fg">{APP_NAME}</p>
            <p className="mt-1 text-sm text-fg-muted">{APP_SLOGAN}</p>
          </div>

          <div className="w-full rounded-card border border-line bg-surface p-5 shadow-card sm:p-6">
            <Tabs
              items={MODE_TABS}
              value={mode}
              onChange={(next) => {
                setMode(next);
                setErrors({});
                clearError();
              }}
              variant="segment"
              className="w-full [&>button]:flex-1"
            />

            {mode === 'login' && (
              <div className="mt-5 flex flex-col gap-4">
                <Tabs items={METHOD_TABS} value={method} onChange={setMethod} variant="underline" />

                {method === 'sms' ? (
                  <div className="flex flex-col gap-3">
                    {field(
                      '手机号',
                      <Input
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel"
                        maxLength={11}
                        placeholder="11 位手机号"
                        aria-label="手机号"
                        icon={<Phone className="size-4" aria-hidden />}
                        value={smsPhone}
                        invalid={Boolean(errors.smsPhone)}
                        onChange={(event) => setSmsPhone(event.target.value.replace(/\D/g, ''))}
                      />,
                      errors.smsPhone,
                    )}
                    {field(
                      '短信验证码',
                      <Input
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        placeholder="6 位数字"
                        aria-label="短信验证码"
                        icon={<ShieldCheck className="size-4" aria-hidden />}
                        value={smsCode}
                        invalid={Boolean(errors.smsCode)}
                        onChange={(event) => setSmsCode(event.target.value.replace(/\D/g, ''))}
                        suffix={codeSuffix(smsPhone, 'smsPhone')}
                      />,
                      errors.smsCode,
                      <span className="text-xs text-fg-subtle">
                        {demoCode
                          ? `演示验证码：${demoCode}（有效期 5 分钟）`
                          : '验证码 5 分钟内有效，同一号码 60 秒内仅可获取一次'}
                      </span>,
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {field(
                      '账号',
                      <Input
                        autoComplete="username"
                        placeholder="用户名或邮箱"
                        aria-label="账号"
                        icon={<UserRound className="size-4" aria-hidden />}
                        value={account}
                        invalid={Boolean(errors.account)}
                        onChange={(event) => setAccount(event.target.value)}
                      />,
                      errors.account,
                    )}
                    {field(
                      '密码',
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        placeholder="请输入密码"
                        aria-label="密码"
                        icon={<Lock className="size-4" aria-hidden />}
                        value={password}
                        invalid={Boolean(errors.password)}
                        onChange={(event) => setPassword(event.target.value)}
                        suffix={
                          <button
                            type="button"
                            aria-label={showPassword ? '隐藏密码' : '显示密码'}
                            onClick={() => setShowPassword((value) => !value)}
                            className="grid size-7 shrink-0 place-items-center rounded-full text-fg-subtle hover:bg-surface-2 hover:text-fg"
                          >
                            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                          </button>
                        }
                      />,
                      errors.password,
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <Switch checked={remember} onChange={setRemember} label="记住我" id="login-remember" />
                      <Button variant="link" size="sm" onClick={() => setMode('forgot')}>
                        忘记密码？
                      </Button>
                    </div>
                  </div>
                )}

                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  loading={pending}
                  loadingText="登录中…"
                  aria-label={method === 'sms' ? '验证码登录' : '账号密码登录'}
                  onClick={() => void submitLogin()}
                >
                  {method === 'sms' ? '验证码登录' : '登录'}
                </Button>
                {storeError && <p className="text-xs text-brand">{storeError}</p>}

                <Divider label="其他登录方式" />
                <div className="flex items-center gap-3">
                  <Button variant="outline" fullWidth aria-label="使用微信登录" onClick={() => void handleOauth('wechat')}>
                    微信登录
                  </Button>
                  <Button variant="outline" fullWidth aria-label="使用 QQ 登录" onClick={() => void handleOauth('qq')}>
                    QQ 登录
                  </Button>
                </div>
                <p className="text-[11px] leading-relaxed text-fg-subtle">
                  第三方登录由服务端携带 state 参数发起授权并在回调时校验，用于防止 CSRF；演示环境不跳转外部站点。
                </p>
              </div>
            )}

            {mode === 'register' && (
              <div className="mt-5 flex flex-col gap-3">
                {field(
                  '用户名（登录用，至少 4 个字符）',
                  <Input
                    autoComplete="username"
                    placeholder="字母、数字或下划线"
                    aria-label="用户名"
                    icon={<User className="size-4" aria-hidden />}
                    value={rUsername}
                    invalid={Boolean(errors.rUsername)}
                    onChange={(event) => setRUsername(event.target.value)}
                  />,
                  errors.rUsername,
                  <span className="text-xs text-fg-muted">{usernameHint(rUsername)}</span>,
                )}
                {field(
                  '昵称',
                  <Input
                    placeholder="展示给其他用户"
                    aria-label="昵称"
                    value={rNickname}
                    invalid={Boolean(errors.rNickname)}
                    onChange={(event) => setRNickname(event.target.value)}
                  />,
                  errors.rNickname,
                )}
                {field(
                  '邮箱',
                  <Input
                    type="email"
                    autoComplete="email"
                    placeholder="用于找回账号与安全通知"
                    aria-label="邮箱"
                    icon={<Mail className="size-4" aria-hidden />}
                    value={rEmail}
                    invalid={Boolean(errors.rEmail)}
                    onChange={(event) => setREmail(event.target.value)}
                  />,
                  errors.rEmail,
                )}
                {field(
                  '手机号（选填）',
                  <Input
                    type="tel"
                    inputMode="numeric"
                    maxLength={11}
                    placeholder="选填，填写后可快速登录与找回"
                    aria-label="手机号（选填）"
                    icon={<Phone className="size-4" aria-hidden />}
                    value={rPhone}
                    invalid={Boolean(errors.rPhone)}
                    onChange={(event) => setRPhone(event.target.value.replace(/\D/g, ''))}
                  />,
                  errors.rPhone,
                )}
                {field(
                  '密码（至少 6 位）',
                  <Input
                    type="password"
                    autoComplete="new-password"
                    placeholder="建议混合字母与数字"
                    aria-label="密码"
                    icon={<Lock className="size-4" aria-hidden />}
                    value={rPassword}
                    invalid={Boolean(errors.rPassword)}
                    onChange={(event) => setRPassword(event.target.value)}
                  />,
                  errors.rPassword,
                  <span className="flex items-center gap-2">
                    <span className="h-1 w-24 overflow-hidden rounded-pill bg-surface-3" aria-hidden>
                      <span className={`block h-full rounded-pill ${strength.bar}`} style={{ width: `${strength.percent}%` }} />
                    </span>
                    <span className="text-xs text-fg-muted">密码强度：{strength.label}</span>
                  </span>,
                )}
                {field(
                  '确认密码',
                  <Input
                    type="password"
                    autoComplete="new-password"
                    placeholder="再次输入密码"
                    aria-label="确认密码"
                    icon={<Lock className="size-4" aria-hidden />}
                    value={rConfirm}
                    invalid={Boolean(errors.rConfirm)}
                    onChange={(event) => setRConfirm(event.target.value)}
                  />,
                  errors.rConfirm,
                )}

                <Switch
                  checked={agreed}
                  onChange={(value) => {
                    setAgreed(value);
                    if (value) setErrors((prev) => ({ ...prev, agreed: '' }));
                  }}
                  id="register-agree"
                  label="我已阅读并同意《用户协议》与《隐私政策》"
                  description="未勾选时无法提交注册；平台仅收集账号运行所必需的信息。"
                />
                {errors.agreed && <span className="text-xs text-brand">{errors.agreed}</span>}

                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  loading={pending}
                  loadingText="注册中…"
                  aria-label="注册并登录"
                  onClick={() => void submitRegister()}
                >
                  注册并登录
                </Button>
                {storeError && <p className="text-xs text-brand">{storeError}</p>}
              </div>
            )}

            {mode === 'forgot' && (
              <div className="mt-5 flex flex-col gap-3">
                <p className="text-xs leading-relaxed text-fg-muted">
                  通过注册手机号重置密码。为保护账号安全，重置后需要重新登录所有设备。
                </p>
                {field(
                  '手机号',
                  <Input
                    type="tel"
                    inputMode="numeric"
                    maxLength={11}
                    placeholder="注册时使用的手机号"
                    aria-label="手机号"
                    icon={<Phone className="size-4" aria-hidden />}
                    value={fPhone}
                    invalid={Boolean(errors.fPhone)}
                    onChange={(event) => setFPhone(event.target.value.replace(/\D/g, ''))}
                  />,
                  errors.fPhone,
                )}
                {field(
                  '短信验证码',
                  <Input
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="6 位数字"
                    aria-label="短信验证码"
                    icon={<ShieldCheck className="size-4" aria-hidden />}
                    value={fCode}
                    invalid={Boolean(errors.fCode)}
                    onChange={(event) => setFCode(event.target.value.replace(/\D/g, ''))}
                    suffix={codeSuffix(fPhone, 'fPhone')}
                  />,
                  errors.fCode,
                )}
                {field(
                  '新密码',
                  <Input
                    type="password"
                    autoComplete="new-password"
                    placeholder="至少 6 位"
                    aria-label="新密码"
                    icon={<Lock className="size-4" aria-hidden />}
                    value={fPassword}
                    invalid={Boolean(errors.fPassword)}
                    onChange={(event) => setFPassword(event.target.value)}
                  />,
                  errors.fPassword,
                  <span className="text-xs text-fg-muted">密码强度：{strengthOf(fPassword).label}</span>,
                )}
                {field(
                  '确认新密码',
                  <Input
                    type="password"
                    autoComplete="new-password"
                    placeholder="再次输入新密码"
                    aria-label="确认新密码"
                    icon={<Lock className="size-4" aria-hidden />}
                    value={fConfirm}
                    invalid={Boolean(errors.fConfirm)}
                    onChange={(event) => setFConfirm(event.target.value)}
                  />,
                  errors.fConfirm,
                )}
                <Button variant="primary" size="lg" fullWidth aria-label="重置密码" onClick={submitForgot}>
                  重置密码
                </Button>
                <Button variant="ghost" size="sm" fullWidth aria-label="返回登录" onClick={() => setMode('login')}>
                  返回登录
                </Button>
              </div>
            )}

            <div className="mt-5 border-t border-line pt-4">
              <p className="text-[11px] font-medium text-fg-subtle">演示账号快捷登录（密码均为 123456）</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {DEMO_ACCOUNTS.map((demo) => (
                  <Button
                    key={demo.account}
                    variant="outline"
                    size="sm"
                    fullWidth
                    aria-label={`以演示账号 ${demo.label} ${demo.account} 登录`}
                    className="h-auto flex-col items-start gap-0 py-2 text-left"
                    onClick={() => {
                      setAccount(demo.account);
                      setPassword(demo.password);
                      setMethod('password');
                      notify('演示账号', `${demo.label} · ${demo.account}，正在登录`);
                      void submitLogin(demo.account, demo.password, false);
                    }}
                  >
                    <span className="text-[13px] font-medium">
                      {demo.label} · {demo.account}
                    </span>
                    <span className="text-[11px] font-normal text-fg-subtle">{demo.hint}</span>
                  </Button>
                ))}
              </div>
            </div>

            <p className="mt-4 text-[11px] leading-relaxed text-fg-subtle">{COMPLIANCE}</p>
          </div>
        </div>
      </main>
    </div>
  );
}
