/**
 * 设置页 —— 文档 3.1 / 14.3 / 14.4 / 9.2
 * 分区：账号资料、账号安全、实名认证、播放偏好、外观、隐私与推荐、青少年模式、通知设置、账号注销。
 * 合规重点：可关闭个性化推荐、青少年模式限制说明、注销 7 天冷静期与撤销入口。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  BadgeCheck,
  Bell,
  Clock,
  Eye,
  EyeOff,
  Laptop,
  Lock,
  Monitor,
  ShieldCheck,
  Smartphone,
  Trash2,
  Upload,
  UserRound,
} from 'lucide-react';
import { Avatar, Badge, Button, Divider, Input, RadioGroup, SectionHeader, SurfaceCard, Switch, Tabs, Textarea } from '@/components/ui';
import { authApi } from '@/api/auth';
import { RATE_OPTIONS } from '@/lib/constants';
import { formatDate, maskPhone } from '@/lib/format';
import { useAuthStore } from '@/stores/authStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useUiStore } from '@/stores/uiStore';
import type { Quality } from '@/api/types';

type SectionKey =
  | 'profile' | 'security' | 'realname' | 'playback' | 'appearance'
  | 'privacy' | 'teenager' | 'notification' | 'deactivate';

interface Section { key: SectionKey; label: string; title: string; description: string }

const SECTIONS: Section[] = [
  { key: 'profile', label: '账号资料', title: '账号资料', description: '头像、昵称与联系方式。用户名用于登录，注册后不可修改。' },
  { key: 'security', label: '账号安全', title: '账号安全', description: '修改密码并查看近期登录记录，发现异常设备可立即退出。' },
  { key: 'realname', label: '实名认证', title: '实名认证', description: '通过实名认证后可使用创作者收益结算与版权保护相关功能。' },
  { key: 'playback', label: '播放偏好', title: '播放偏好', description: '默认清晰度、音量与倍速，仅对当前浏览器生效。' },
  { key: 'appearance', label: '外观', title: '外观', description: '主题与动效偏好，跟随系统时会随系统设置自动切换。' },
  { key: 'privacy', label: '隐私与推荐', title: '隐私与推荐', description: '个性化推荐与广告可按需关闭，观看历史仅保存在本机。' },
  { key: 'teenager', label: '青少年模式', title: '青少年模式', description: '限制使用时长与访问时段，开启后需监护人密码方可关闭。' },
  { key: 'notification', label: '通知设置', title: '通知设置', description: '控制站内与推送通知的类型，重要安全通知始终发送。' },
  { key: 'deactivate', label: '账号注销', title: '账号注销', description: '注销申请提交后进入 7 天冷静期，期间可随时撤销。' },
];

const QUALITY_OPTIONS: { value: Quality | 'auto'; label: string; description: string }[] = [
  { value: 'auto', label: '自动', description: '按网络状况自动切换清晰度' },
  { value: '1080p', label: '1080P', description: '画质优先，流量消耗较高' },
  { value: '720p', label: '720P', description: '画质与流量平衡' },
  { value: '480p', label: '480P', description: '流量优先，网络较差时更流畅' },
];

const RATE_RADIOS = RATE_OPTIONS.map((rate) => ({ value: String(rate), label: `${rate}×` }));
const THEME_RADIOS = [
  { value: 'light', label: '亮色' },
  { value: 'dark', label: '暗色' },
  { value: 'system', label: '跟随系统' },
] as const;

const REAL_NAME_LABELS: Record<string, string> = { NONE: '未认证', PENDING: '审核中', CERTIFIED: '已认证', REJECTED: '未通过' };
const REAL_NAME_TONES: Record<string, 'neutral' | 'warning' | 'success' | 'danger'> = {
  NONE: 'neutral', PENDING: 'warning', CERTIFIED: 'success', REJECTED: 'danger',
};

interface DeviceRow { id: string; name: string; location: string; lastActive: string; current: boolean; kind: 'desktop' | 'mobile' }

const DEVICES: DeviceRow[] = [
  { id: 'cur', name: 'Chrome · macOS', location: '本机', lastActive: '正在使用', current: true, kind: 'desktop' },
  { id: 'd2', name: '光影 iOS 客户端', location: '上海 · 移动网络', lastActive: '2026-09-12 21:40', current: false, kind: 'mobile' },
  { id: 'd3', name: 'Edge · Windows', location: '杭州 · 电信', lastActive: '2026-09-10 09:12', current: false, kind: 'desktop' },
  { id: 'd4', name: '光影 Android 客户端', location: '北京 · 联通', lastActive: '2026-09-06 18:03', current: false, kind: 'mobile' },
];

/** 密码强度：仅作填写提示，最终强度判定以服务端为准 */
function passwordStrength(password: string): { label: string; percent: number; bar: string } {
  if (!password) return { label: '未填写', percent: 0, bar: 'bg-surface-3' };
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[A-Za-z]/.test(password) && /\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  if (password.length >= 12) score += 1;
  if (score <= 1) return { label: '弱', percent: 30, bar: 'bg-brand' };
  if (score === 2) return { label: '中', percent: 60, bar: 'bg-warning' };
  if (score === 3) return { label: '较强', percent: 80, bar: 'bg-accent' };
  return { label: '强', percent: 100, bar: 'bg-success' };
}

function toast(title: string, description?: string, tone: 'info' | 'success' | 'warning' | 'error' = 'info') {
  useUiStore.getState().toast({ title, description, tone });
}

function StrengthMeter({ password }: { password: string }) {
  const { label, percent, bar } = passwordStrength(password);
  return (
    <span className="flex items-center gap-2">
      <span className="h-1 w-24 overflow-hidden rounded-pill bg-surface-3" aria-hidden>
        <span className={`block h-full rounded-pill ${bar}`} style={{ width: `${percent}%` }} />
      </span>
      <span className="text-xs text-fg-muted">密码强度：{label}</span>
    </span>
  );
}

/** 分区骨架：锚点 id + 标题 + 说明 + 内容 */
function SectionCard({ section, children }: { section: Section; children: ReactNode }) {
  return (
    <section id={section.key} className="scroll-mt-20" aria-label={section.title}>
      <SurfaceCard className="flex flex-col gap-4">
        <SectionHeader level={2} title={section.title} subtitle={section.description} />
        <Divider />
        {children}
      </SurfaceCard>
    </section>
  );
}

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const patchUser = useAuthStore((s) => s.patchUser);
  const [active, setActive] = useState<SectionKey>('profile');

  const [nickname, setNickname] = useState('');
  const [bio, setBio] = useState('');
  const [profileError, setProfileError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [savingPassword, setSavingPassword] = useState(false);
  const [devices, setDevices] = useState<DeviceRow[]>(DEVICES);

  const [realName, setRealName] = useState('');
  const [idCard, setIdCard] = useState('');
  const [realNamePhone, setRealNamePhone] = useState('');
  const [realNameErrors, setRealNameErrors] = useState<Record<string, string>>({});
  const [submittingRealName, setSubmittingRealName] = useState(false);
  const [realNameStatus, setRealNameStatus] = useState('NONE');
  const [hydratedUserId, setHydratedUserId] = useState<number | null>(null);

  const quality = usePlayerStore((s) => s.quality);
  const volume = usePlayerStore((s) => s.volume);
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const autoplayNext = usePlayerStore((s) => s.autoplayNext);
  const setQuality = usePlayerStore((s) => s.setQuality);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const setPlaybackRate = usePlayerStore((s) => s.setPlaybackRate);
  const setAutoplayNext = usePlayerStore((s) => s.setAutoplayNext);

  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const reducedMotion = useUiStore((s) => s.reducedMotion);
  const setReducedMotion = useUiStore((s) => s.setReducedMotion);
  const personalizationEnabled = useUiStore((s) => s.personalizationEnabled);
  const setPersonalization = useUiStore((s) => s.setPersonalization);
  const teenagerMode = useUiStore((s) => s.teenagerMode);
  const setTeenagerMode = useUiStore((s) => s.setTeenagerMode);

  const [watchHistory, setWatchHistory] = useState(true);
  const [personalizedAds, setPersonalizedAds] = useState(false);
  const [notifyInteraction, setNotifyInteraction] = useState(true);
  const [notifySystem, setNotifySystem] = useState(true);
  const [notifySubscription, setNotifySubscription] = useState(false);

  const [deactivateScheduledAt, setDeactivateScheduledAt] = useState<string | null>(null);
  const [requestingDeactivate, setRequestingDeactivate] = useState(false);

  // 首次拿到用户资料时预填表单（渲染期同步状态，避免 effect 级联渲染）
  if (user && hydratedUserId !== user.id) {
    setHydratedUserId(user.id);
    setNickname(user.nickname);
    setBio(user.bio ?? '');
    setRealNamePhone(user.phone ?? '');
    setRealNameStatus(user.realNameStatus ?? 'NONE');
  }

  // 锚点高亮：滚动时同步左侧导航当前分区
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top?.target.id) setActive(top.target.id as SectionKey);
      },
      { rootMargin: '-88px 0px -70% 0px' },
    );
    for (const section of SECTIONS) {
      const node = document.getElementById(section.key);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, []);

  const goTo = (key: SectionKey) => {
    setActive(key);
    document.getElementById(key)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const saveProfile = async () => {
    const trimmed = nickname.trim();
    if (trimmed.length < 2 || trimmed.length > 20) {
      setProfileError('昵称需为 2–20 个字符');
      return;
    }
    setProfileError('');
    setSavingProfile(true);
    try {
      const updated = await authApi.updateProfile({ nickname: trimmed, bio: bio.trim() });
      patchUser({ nickname: updated.nickname, bio: updated.bio });
      toast('资料已保存', undefined, 'success');
    } catch (error) {
      toast('保存失败', error instanceof Error ? error.message : '请稍后重试', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const changeAvatar = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast('头像格式不支持', '请选择 JPG 或 PNG 图片', 'warning');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast('头像过大', '请选择 2MB 以内的图片', 'warning');
      return;
    }
    setUploadingAvatar(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('读取图片失败'));
        reader.readAsDataURL(file);
      });
      const updated = await authApi.updateProfile({ avatar: dataUrl });
      patchUser({ avatar: updated.avatar });
      toast('头像已更新', undefined, 'success');
    } catch (error) {
      toast('头像更新失败', error instanceof Error ? error.message : '请稍后重试', 'error');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const changePassword = async () => {
    const next: Record<string, string> = {};
    if (oldPassword.length < 6) next.oldPassword = '请输入原密码';
    if (newPassword.length < 8) next.newPassword = '新密码至少 8 位';
    if (newPassword === oldPassword) next.newPassword = '新密码不能与原密码相同';
    if (confirmPassword !== newPassword) next.confirmPassword = '两次输入的新密码不一致';
    setPasswordErrors(next);
    if (Object.keys(next).length > 0) return;
    setSavingPassword(true);
    try {
      await authApi.changePassword(oldPassword, newPassword);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast('密码已修改', '其他设备需重新登录', 'success');
    } catch (error) {
      toast('密码修改失败', error instanceof Error ? error.message : '请稍后重试', 'error');
    } finally {
      setSavingPassword(false);
    }
  };

  const submitRealName = async () => {
    const next: Record<string, string> = {};
    if (realName.trim().length < 2) next.realName = '请输入真实姓名';
    if (!/^\d{17}[\dXx]$/.test(idCard)) next.idCard = '请输入 18 位身份证号';
    if (!/^1[3-9]\d{9}$/.test(realNamePhone)) next.phone = '请输入 11 位手机号';
    setRealNameErrors(next);
    if (Object.keys(next).length > 0) return;
    setSubmittingRealName(true);
    try {
      await authApi.submitRealName({ realName: realName.trim(), idCard, phone: realNamePhone });
      setRealNameStatus('PENDING');
      patchUser({ realNameStatus: 'PENDING' });
      setRealName('');
      setIdCard('');
      toast('实名信息已提交', '通常在 1 个工作日内完成核验', 'success');
    } catch (error) {
      toast('提交失败', error instanceof Error ? error.message : '请稍后重试', 'error');
    } finally {
      setSubmittingRealName(false);
    }
  };

  const requestDeactivate = () => {
    useUiStore.getState().openConfirm({
      title: '确认注销账号？',
      description: '注销后进入 7 天冷静期，期间可随时撤销；冷静期结束后账号信息将被匿名化处理。',
      confirmText: '提交注销申请',
      danger: true,
      onConfirm: async () => {
        setRequestingDeactivate(true);
        try {
          const result = await authApi.requestDeactivate('用户主动注销');
          setDeactivateScheduledAt(result.scheduledAt);
          toast('注销申请已提交', `冷静期至 ${formatDate(result.scheduledAt)}，期间可撤销`, 'warning');
        } catch (error) {
          toast('提交失败', error instanceof Error ? error.message : '请稍后重试', 'error');
        } finally {
          setRequestingDeactivate(false);
        }
      },
    });
  };

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
        <SurfaceCard className="flex flex-col items-center gap-3 text-center">
          <UserRound className="size-6 text-fg-subtle" aria-hidden />
          <p className="text-sm font-medium text-fg">尚未登录</p>
          <p className="text-xs text-fg-muted">登录后可管理账号资料、播放偏好与隐私设置。</p>
        </SurfaceCard>
      </div>
    );
  }

  const togglePassword = showPasswords ? 'text' : 'password';
  const passwordTypeProps = { type: togglePassword, autoComplete: 'new-password' as const };

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6 lg:py-8">
      <SectionHeader
        level={1}
        title="设置"
        subtitle="账号资料、播放偏好与合规选项集中在此管理，修改即时生效。"
        className="mb-5"
      />

      <div className="lg:flex lg:items-start lg:gap-8">
        <nav aria-label="设置分区导航" className="hidden lg:sticky lg:top-20 lg:block lg:w-52 lg:shrink-0">
          <ul className="flex flex-col gap-1">
            {SECTIONS.map((section) => (
              <li key={section.key}>
                <button
                  type="button"
                  aria-label={`跳转到${section.label}`}
                  aria-current={active === section.key ? 'true' : undefined}
                  onClick={() => goTo(section.key)}
                  className={`h-10 w-full rounded-btn px-3 text-left text-[13px] font-medium transition-colors ${
                    active === section.key ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
                  }`}
                >
                  {section.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mb-4 lg:hidden">
          <Tabs
            items={SECTIONS.map((section) => ({ key: section.key, label: section.label }))}
            value={active}
            onChange={goTo}
            variant="pill"
            size="sm"
            scrollable
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-5">
          {/* 1. 账号资料 */}
          <SectionCard section={SECTIONS[0]}>
            <div className="flex flex-wrap items-center gap-4">
              <Avatar src={user.avatar} name={user.nickname} size="xl" certified={user.certified} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">头像</p>
                <p className="mt-0.5 text-xs text-fg-muted">支持 JPG、PNG，2MB 以内，建议使用正方形图片。</p>
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg"
                className="sr-only"
                aria-label="选择头像文件"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void changeAvatar(file);
                  event.target.value = '';
                }}
              />
              <Button
                variant="outline"
                size="sm"
                icon={<Upload className="size-3.5" aria-hidden />}
                loading={uploadingAvatar}
                aria-label="更换头像"
                onClick={() => avatarInputRef.current?.click()}
              >
                更换头像
              </Button>
            </div>
            <Divider />
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">昵称</span>
              <Input aria-label="昵称" value={nickname} maxLength={20} invalid={Boolean(profileError)} onChange={(event) => setNickname(event.target.value)} />
              {profileError ? <span className="text-xs text-brand">{profileError}</span> : <span className="text-xs text-fg-subtle">2–20 个字符，将展示在视频与评论中</span>}
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">个人简介</span>
              <Textarea aria-label="个人简介" rows={3} maxLength={500} placeholder="简单介绍你的创作方向" value={bio} onChange={(event) => setBio(event.target.value)} />
              <span className="text-xs text-fg-subtle">{bio.length}/500 字</span>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-fg-muted">用户名（只读）</span>
                <Input aria-label="用户名" value={user.username} readOnly disabled />
                <span className="text-xs text-fg-subtle">用户名用于登录，注册后不可修改。</span>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-fg-muted">邮箱</span>
                <Input aria-label="邮箱" value={user.email ?? '未绑定'} readOnly disabled />
                <span className="text-xs text-fg-subtle">用于账号找回与安全通知。</span>
              </label>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">手机号</span>
              <Input aria-label="手机号" value={maskPhone(user.phone) || '未绑定'} readOnly disabled />
              <span className="text-xs text-fg-subtle">页面仅展示脱敏号码，完整号码不会下发到前端。</span>
            </label>
            <div className="flex justify-end">
              <Button variant="primary" size="sm" loading={savingProfile} aria-label="保存资料" onClick={() => void saveProfile()}>
                保存资料
              </Button>
            </div>
          </SectionCard>

          {/* 2. 账号安全 */}
          <SectionCard section={SECTIONS[1]}>
            <h3 className="text-sm font-medium text-fg">修改密码</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-fg-muted">原密码</span>
                <Input
                  type={showPasswords ? 'text' : 'password'}
                  autoComplete="current-password"
                  aria-label="原密码"
                  icon={<Lock className="size-4" aria-hidden />}
                  value={oldPassword}
                  invalid={Boolean(passwordErrors.oldPassword)}
                  onChange={(event) => setOldPassword(event.target.value)}
                />
                {passwordErrors.oldPassword && <span className="text-xs text-brand">{passwordErrors.oldPassword}</span>}
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-fg-muted">新密码（至少 8 位）</span>
                <Input
                  {...passwordTypeProps}
                  aria-label="新密码"
                  icon={<Lock className="size-4" aria-hidden />}
                  value={newPassword}
                  invalid={Boolean(passwordErrors.newPassword)}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                {passwordErrors.newPassword && <span className="text-xs text-brand">{passwordErrors.newPassword}</span>}
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-fg-muted">确认新密码</span>
                <Input
                  {...passwordTypeProps}
                  aria-label="确认新密码"
                  icon={<Lock className="size-4" aria-hidden />}
                  value={confirmPassword}
                  invalid={Boolean(passwordErrors.confirmPassword)}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
                {passwordErrors.confirmPassword && <span className="text-xs text-brand">{passwordErrors.confirmPassword}</span>}
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex flex-wrap items-center gap-2">
                <StrengthMeter password={newPassword} />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={showPasswords ? '隐藏密码' : '显示密码'}
                  icon={showPasswords ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
                  onClick={() => setShowPasswords((value) => !value)}
                >
                  {showPasswords ? '隐藏' : '显示'}
                </Button>
              </span>
              <Button variant="primary" size="sm" loading={savingPassword} aria-label="提交修改密码" onClick={() => void changePassword()}>
                修改密码
              </Button>
            </div>
            <Divider />
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium text-fg">登录设备管理</h3>
              <Button
                variant="outline"
                size="sm"
                aria-label="退出全部设备"
                onClick={() =>
                  useUiStore.getState().openConfirm({
                    title: '退出全部设备？',
                    description: '包括当前设备在内的所有登录状态都会被清除，其他设备需重新登录。',
                    confirmText: '全部退出',
                    danger: true,
                    onConfirm: () => {
                      setDevices((rows) => rows.filter((row) => row.current));
                      toast('已退出其他设备', '其他设备的登录状态已失效', 'success');
                    },
                  })
                }
              >
                退出全部设备
              </Button>
            </div>
            <ul className="flex flex-col divide-y divide-line">
              {devices.map((device) => (
                <li key={device.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-fg-muted">
                      {device.kind === 'mobile' ? <Smartphone className="size-4" aria-hidden /> : <Laptop className="size-4" aria-hidden />}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-fg">{device.name}</span>
                        {device.current && <Badge tone="success">当前设备</Badge>}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-fg-muted">
                        {device.location} · {device.lastActive}
                      </span>
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={device.current}
                    aria-label={`退出设备 ${device.name}`}
                    onClick={() => {
                      setDevices((rows) => rows.filter((row) => row.id !== device.id));
                      toast('已退出该设备', device.name, 'success');
                    }}
                  >
                    {device.current ? '本机' : '退出该设备'}
                  </Button>
                </li>
              ))}
            </ul>
          </SectionCard>

          {/* 3. 实名认证 */}
          <SectionCard section={SECTIONS[2]}>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-btn border border-line bg-surface-2 px-3.5 py-3">
              <span className="flex items-center gap-2">
                <BadgeCheck className={`size-4 ${realNameStatus === 'CERTIFIED' ? 'text-accent' : 'text-fg-subtle'}`} aria-hidden />
                <span className="text-[13px] font-medium text-fg">当前状态</span>
                <Badge tone={REAL_NAME_TONES[realNameStatus] ?? 'neutral'}>{REAL_NAME_LABELS[realNameStatus] ?? '未认证'}</Badge>
              </span>
              <span className="text-xs text-fg-muted">
                {realNameStatus === 'CERTIFIED'
                  ? `认证时间：${formatDate(user.createdAt)}`
                  : realNameStatus === 'PENDING'
                    ? '已提交，通常 1 个工作日内完成核验'
                    : '认证后可申请创作者收益结算'}
              </span>
            </div>

            {realNameStatus === 'NONE' || realNameStatus === 'REJECTED' ? (
              <>
                {realNameStatus === 'REJECTED' && (
                  <p className="text-xs leading-relaxed text-warning">上次提交的信息未通过核验，请核对姓名与身份证号后重新提交。</p>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-fg-muted">真实姓名</span>
                    <Input
                      aria-label="真实姓名"
                      placeholder="与身份证一致"
                      value={realName}
                      invalid={Boolean(realNameErrors.realName)}
                      onChange={(event) => setRealName(event.target.value)}
                    />
                    {realNameErrors.realName && <span className="text-xs text-brand">{realNameErrors.realName}</span>}
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-fg-muted">身份证号</span>
                    <Input
                      aria-label="身份证号"
                      placeholder="18 位身份证号"
                      maxLength={18}
                      value={idCard}
                      invalid={Boolean(realNameErrors.idCard)}
                      onChange={(event) => setIdCard(event.target.value.replace(/[^\dXx]/g, ''))}
                    />
                    {realNameErrors.idCard && <span className="text-xs text-brand">{realNameErrors.idCard}</span>}
                  </label>
                </div>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-fg-muted">手机号</span>
                  <Input
                    type="tel"
                    inputMode="numeric"
                    maxLength={11}
                    aria-label="实名认证手机号"
                    icon={<Smartphone className="size-4" aria-hidden />}
                    value={realNamePhone}
                    invalid={Boolean(realNameErrors.phone)}
                    onChange={(event) => setRealNamePhone(event.target.value.replace(/\D/g, ''))}
                  />
                  {realNameErrors.phone && <span className="text-xs text-brand">{realNameErrors.phone}</span>}
                </label>
                <p className="text-xs leading-relaxed text-fg-muted">
                  实名信息仅用于创作者认证与合规要求，平台加密存储，不对外展示；核验完成后身份证号不再明文保留。
                </p>
                <div className="flex justify-end">
                  <Button variant="primary" size="sm" loading={submittingRealName} aria-label="提交实名认证" onClick={() => void submitRealName()}>
                    提交认证
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-[13px] font-medium text-fg">
                  {realNameStatus === 'CERTIFIED' ? '已完成实名认证' : '实名信息审核中'}
                </p>
                <p className="text-xs leading-relaxed text-fg-muted">
                  {realNameStatus === 'CERTIFIED'
                    ? '认证信息已加密存储，仅用于创作者结算与法律要求的合规核验，不会展示给其他用户。'
                    : '审核期间无需重复提交；若信息有误，可在审核结束后重新提交。'}
                </p>
              </div>
            )}
          </SectionCard>

          {/* 4. 播放偏好 */}
          <SectionCard section={SECTIONS[3]}>
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium text-fg">默认清晰度</h3>
                <RadioGroup
                  name="default-quality"
                  value={quality ?? 'auto'}
                  options={QUALITY_OPTIONS}
                  onChange={(value) => {
                    setQuality(value === 'auto' ? '1080p' : value);
                    toast('默认清晰度已更新', value === 'auto' ? '自动：按网络状况切换清晰度' : `固定为 ${value.toUpperCase()}`);
                  }}
                />
                {quality === null && <p className="text-xs text-fg-subtle">当前为自动模式：按网络状况自动切换清晰度。</p>}
              </div>
              <div className="flex flex-col gap-5">
                <Switch
                  checked={autoplayNext}
                  onChange={(value) => {
                    setAutoplayNext(value);
                    toast(value ? '已开启自动连播' : '已关闭自动连播');
                  }}
                  label="自动连播"
                  description="当前视频结束后自动播放推荐列表的下一支"
                />
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-fg-muted">默认音量：{Math.round(volume * 100)}%</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(volume * 100)}
                    aria-label="默认音量"
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-pill bg-surface-3 accent-[var(--c-accent)]"
                    onChange={(event) => setVolume(Number(event.target.value) / 100)}
                  />
                  <span className="text-xs text-fg-subtle">音量设为 0 时进入静音状态。</span>
                </label>
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium text-fg">默认倍速</h3>
                  <RadioGroup
                    name="default-rate"
                    className="grid grid-cols-2 gap-2 sm:grid-cols-3"
                    value={String(playbackRate)}
                    options={RATE_RADIOS}
                    onChange={(value) => {
                      setPlaybackRate(Number(value));
                      toast('默认倍速已更新', `${value}×`);
                    }}
                  />
                </div>
              </div>
            </div>
          </SectionCard>

          {/* 5. 外观 */}
          <SectionCard section={SECTIONS[4]}>
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium text-fg">主题</h3>
                <RadioGroup
                  name="theme"
                  value={theme}
                  options={THEME_RADIOS.map((option) => ({ value: option.value, label: option.label }))}
                  onChange={(value) => setTheme(value)}
                />
              </div>
              <div className="flex flex-col gap-4">
                <Switch
                  checked={reducedMotion}
                  onChange={(value) => {
                    setReducedMotion(value);
                    toast(value ? '已减弱动效' : '已恢复完整动效');
                  }}
                  label="减弱动效"
                  description="关闭页面切换与列表进入动画，适合对动效敏感的用户"
                />
                <p className="text-xs leading-relaxed text-fg-muted">
                  系统已开启「减少动态效果」时，页面动画会自动降级，无需在此重复设置。
                </p>
              </div>
            </div>
          </SectionCard>

          {/* 6. 隐私与推荐 */}
          <SectionCard section={SECTIONS[5]}>
            <Switch
              checked={!personalizationEnabled}
              onChange={(value) => setPersonalization(!value)}
              label="关闭个性化推荐"
              description="关闭后首页仅展示热门与时间线内容，依据《互联网信息服务算法推荐管理规定》提供该选项。"
            />
            <Divider />
            <Switch
              checked={watchHistory}
              onChange={(value) => {
                setWatchHistory(value);
                toast(value ? '已开启观看历史记录' : '已关闭观看历史记录', value ? undefined : '新产生的观看记录不再保存');
              }}
              label="记录观看历史"
              description="用于继续播放与进度记忆；记录仅保存在本机，可在观看历史页清空。"
            />
            <Divider />
            <Switch
              checked={personalizedAds}
              onChange={(value) => {
                setPersonalizedAds(value);
                toast(value ? '已开启个性化广告' : '已关闭个性化广告', '广告数量不变，仅不再依据浏览行为投放');
              }}
              label="个性化广告"
              description="关闭后广告数量不变，仅不再依据浏览行为进行投放。"
            />
          </SectionCard>

          {/* 7. 青少年模式 */}
          <SectionCard section={SECTIONS[6]}>
            <Switch
              checked={teenagerMode}
              onChange={(value) => {
                setTeenagerMode(value);
                toast(value ? '青少年模式已开启' : '青少年模式已关闭', value ? undefined : '已恢复常规内容推荐');
              }}
              label="青少年模式"
              description="开启后仅展示适龄内容，并限制单日使用时长与访问时段。"
            />
            {teenagerMode ? (
              <div className="flex flex-col gap-2 rounded-btn border border-line bg-surface-2 px-3.5 py-3 text-xs leading-relaxed text-fg-muted">
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
                  <Clock className="size-3.5" aria-hidden />
                  使用限制（只读）
                </p>
                <p>每日使用时长上限：40 分钟，达到上限后当日不可继续观看。</p>
                <p>宵禁时段：22:00–06:00，该时段内无法播放视频。</p>
                <p>开启后需监护人密码方可关闭；关闭后立即恢复常规内容推荐。</p>
              </div>
            ) : (
              <p className="text-xs leading-relaxed text-fg-muted">
                未开启时按常规推荐展示内容。开启后每日上限 40 分钟，22:00–06:00 为宵禁时段。
              </p>
            )}
          </SectionCard>

          {/* 8. 通知设置 */}
          <SectionCard section={SECTIONS[7]}>
            <Switch
              checked={notifyInteraction}
              onChange={(value) => {
                setNotifyInteraction(value);
                toast(value ? '已开启互动通知' : '已关闭互动通知');
              }}
              label="互动通知"
              description="点赞、评论、回复与关注"
            />
            <Switch
              checked={notifySystem}
              onChange={(value) => {
                setNotifySystem(value);
                toast(value ? '已开启系统通知' : '已关闭系统通知');
              }}
              label="系统通知"
              description="账号安全、审核结果与平台公告"
            />
            <Switch
              checked={notifySubscription}
              onChange={(value) => {
                setNotifySubscription(value);
                toast(value ? '已开启订阅更新' : '已关闭订阅更新');
              }}
              label="订阅更新"
              description="已订阅创作者发布新内容时提醒"
            />
            <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
              <Bell className="size-3.5" aria-hidden />
              账号安全与违规处理类通知无法关闭，用于保障账号与内容合规。
            </p>
          </SectionCard>

          {/* 9. 账号注销 */}
          <section id="deactivate" className="scroll-mt-20" aria-label={SECTIONS[8].title}>
            <SurfaceCard className="flex flex-col gap-4 border-brand/40">
              <SectionHeader
                level={2}
                title="账号注销"
                subtitle="注销后进入 7 天冷静期，期间可撤销；冷静期结束后账号信息将被匿名化处理，已发布内容不再展示作者信息。"
                action={<Badge tone="danger">不可恢复</Badge>}
              />
              {deactivateScheduledAt ? (
                <div className="flex flex-col gap-2 rounded-btn border border-line bg-surface-2 px-3.5 py-3">
                  <p className="text-[13px] font-medium text-fg">注销申请已提交，冷静期截止 {formatDate(deactivateScheduledAt)}</p>
                  <p className="text-xs leading-relaxed text-fg-muted">
                    截止前账号可正常使用与登录；如需继续使用平台，可在截止日前撤销申请。
                  </p>
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label="撤销注销申请"
                      onClick={() => {
                        setDeactivateScheduledAt(null);
                        toast('已撤销注销申请', '账号将继续保持正常状态', 'success');
                      }}
                    >
                      撤销注销申请
                    </Button>
                  </div>
                </div>
              ) : (
                <ul className="flex flex-col gap-1.5 text-xs leading-relaxed text-fg-muted">
                  <li className="flex items-start gap-1.5">
                    <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    冷静期内可随时撤销，账号与已发布内容保持不变。
                  </li>
                  <li className="flex items-start gap-1.5">
                    <Trash2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    冷静期结束后昵称、头像与联系方式将被匿名化，评论与视频不再关联到个人。
                  </li>
                  <li className="flex items-start gap-1.5">
                    <Monitor className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    依法需要留存的审核与交易记录会按最小必要原则继续保存。
                  </li>
                </ul>
              )}
              <div className="flex justify-end">
                <Button variant="danger" size="sm" loading={requestingDeactivate} aria-label="申请注销账号" onClick={requestDeactivate}>
                  申请注销账号
                </Button>
              </div>
            </SurfaceCard>
          </section>
        </div>
      </div>
    </div>
  );
}
