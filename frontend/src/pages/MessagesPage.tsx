/**
 * 消息中心（开发文档 3.1）：互动通知 + 私信
 * - 通知：类型筛选、分页、实时推送状态、单条/全部标记已读、按目标类型跳转
 * - 私信：桌面两栏会话布局，移动端列表/对话切换，回车发送 + 乐观追加
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bell,
  CheckCheck,
  Image as ImageIcon,
  Inbox,
  MessageCircle,
  MessageSquare,
  Rss,
  Send,
  ShieldCheck,
  Star,
  ThumbsUp,
  UserPlus,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { dayjs, formatRelative } from '@/lib/format';
import { temporaryNumericId } from '@/lib/id';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/stores/authStore';
import { countByType, useNotificationStore } from '@/stores/notificationStore';
import { useUiStore } from '@/stores/uiStore';
import {
  useConversations,
  useMarkNotificationsRead,
  useMessages,
  useNotifications,
  useSendMessage,
  useUnreadCount,
  useUploadMessageAttachment,
} from '@/hooks/useApi';
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  ListSkeleton,
  PageContainer,
  Pagination,
  SectionHeader,
  SurfaceCard,
  Tabs,
  Textarea,
} from '@/components/ui';
import type { AppNotification, DirectMessage, NotificationType } from '@/api/types';

type MessagesTab = 'notification' | 'message';
type NotificationFilter = NotificationType | 'ALL';
type RealtimeStatus = 'connecting' | 'online' | 'offline' | 'degraded';

const NOTIFICATION_PAGE_SIZE = 20;
const MESSAGE_MAX_LENGTH = 500;
/** 相邻消息间隔超过该值时插入时间分隔（分钟） */
const TIME_DIVIDER_MINUTES = 5;

const NOTIFICATION_ICONS: Record<NotificationType, LucideIcon> = {
  LIKE: ThumbsUp,
  COMMENT: MessageSquare,
  REPLY: MessageCircle,
  FOLLOW: UserPlus,
  FAVORITE: Star,
  REVIEW: ShieldCheck,
  SYSTEM: Bell,
  SUBSCRIPTION: Rss,
};

const FILTER_ICONS: Record<NotificationFilter, LucideIcon> = {
  ALL: Inbox,
  ...NOTIFICATION_ICONS,
};

const FILTER_LABELS: Record<NotificationFilter, string> = {
  ALL: '全部',
  LIKE: '赞了你的视频',
  COMMENT: '评论',
  REPLY: '回复',
  FOLLOW: '关注',
  FAVORITE: '收藏',
  REVIEW: '审核结果',
  SYSTEM: '系统通知',
  SUBSCRIPTION: '订阅更新',
};

const FILTER_ORDER: NotificationFilter[] = [
  'ALL',
  'LIKE',
  'COMMENT',
  'REPLY',
  'FOLLOW',
  'FAVORITE',
  'REVIEW',
  'SYSTEM',
  'SUBSCRIPTION',
];

const REALTIME_TEXT: Record<RealtimeStatus, string> = {
  online: '实时推送已连接',
  connecting: '实时推送连接中',
  offline: '实时推送已降级为轮询',
  degraded: '实时推送已降级为轮询',
};

function realtimeDotClass(status: RealtimeStatus): string {
  if (status === 'online') return 'bg-success';
  if (status === 'connecting') return 'animate-pulse-dot bg-warning';
  return 'bg-fg-subtle';
}

export default function MessagesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const tabParam = searchParams.get('tab');
  const tab: MessagesTab =
    tabParam === 'notification' || (!tabParam && location.hash === '#notifications') ? 'notification' : 'message';

  function switchTab(next: MessagesTab) {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  }

  return (
    <PageContainer className="py-4 sm:py-6">
      <SectionHeader
        level={1}
        title="消息中心"
        subtitle="别人对你作品的互动、审核结果与站内私信都集中在这里。"
        className="mb-4"
      />
      <Tabs
        className="mb-4"
        items={[
          { key: 'notification', label: '互动通知' },
          { key: 'message', label: '私信' },
        ]}
        value={tab}
        onChange={switchTab}
      />
      {tab === 'notification' ? <NotificationSection /> : <MessageSection />}
    </PageContainer>
  );
}

/* ------------------------------------------------------------ 互动通知 */

function NotificationSection() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [type, setType] = useState<NotificationFilter>('ALL');

  const { data, isLoading, isError, refetch } = useNotifications({
    page,
    pageSize: NOTIFICATION_PAGE_SIZE,
    type: type === 'ALL' ? undefined : type,
  });
  const markRead = useMarkNotificationsRead();

  const storeItems = useNotificationStore((s) => s.items);
  const markStoreRead = useNotificationStore((s) => s.markRead);
  const realtimeStatus = useNotificationStore((s) => s.realtimeStatus);
  const toast = useUiStore((s) => s.toast);
  /** 未读数以服务端为准：标记已读会失效 ['notifications']，该查询会自动重取 */
  const { data: unreadData } = useUnreadCount();
  const unreadCount = unreadData?.count ?? data?.unreadCount ?? 0;

  const items = useMemo(() => data?.items ?? [], [data]);
  /**
   * 各类型计数一律以服务端为准（`typeCounts`）。
   *
   * 此前是从「当前已加载的那一页」在前端统计的，初始只加载全部类型的第一页，
   * 没出现在该页的类型恒为 0，点进去才变——就是「不点击显示 0」的原因。
   * 本地列表只在服务端字段缺失时兜底（例如旧缓存响应）。
   */
  const counts = useMemo<Record<NotificationFilter, number>>(() => {
    const server = data?.typeCounts;
    if (server) {
      const next = {} as Record<NotificationFilter, number>;
      for (const key of FILTER_ORDER) {
        next[key] = key === 'ALL' ? (data?.total ?? 0) : (server[key] ?? 0);
      }
      return next;
    }
    const fallback = countByType(storeItems.length >= items.length ? storeItems : items);
    return { ...fallback, ALL: data?.total ?? fallback.ALL };
  }, [data, storeItems, items]);

  function selectFilter(next: NotificationFilter) {
    setType(next);
    setPage(1);
  }

  function markOne(id: number) {
    markRead.mutate([id]);
    markStoreRead([id]);
  }

  function markAll() {
    markRead.mutate([]);
    markStoreRead();
    toast({ title: '已全部标为已读', tone: 'success' });
  }

  function openNotification(item: AppNotification) {
    if (!item.isRead) markOne(item.id);
    if (item.targetId === null) return;
    if (item.targetType === 'VIDEO') navigate(`/video/${item.targetId}`);
    else if (item.targetType === 'USER') navigate(`/user/${item.targetId}`);
    else if (item.targetType === 'FEED') navigate(`/feed/${item.targetId}`);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[208px_minmax(0,1fr)]">
      {/* 桌面端类型筛选 */}
      <nav aria-label="通知类型" className="hidden lg:block">
        <ul className="sticky top-20 flex flex-col gap-0.5">
          {FILTER_ORDER.map((key) => {
            const Icon = FILTER_ICONS[key];
            const active = key === type;
            return (
              <li key={key}>
                <button
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => selectFilter(key)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-btn px-2.5 py-2 text-left text-[13px] transition-colors',
                    active ? 'bg-surface-2 font-medium text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{FILTER_LABELS[key]}</span>
                  <span className="text-[11px] tabular-nums text-fg-subtle">{counts[key]}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="min-w-0">
        {/* 移动端类型筛选 */}
        <Tabs
          className="mb-3 lg:hidden"
          variant="pill"
          size="sm"
          scrollable
          items={FILTER_ORDER.map((key) => ({
            key,
            label: FILTER_LABELS[key],
            count: counts[key],
          }))}
          value={type}
          onChange={selectFilter}
        />

        <SurfaceCard padded={false} className="overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-subtle">
              <span className={cn('size-1.5 rounded-full', realtimeDotClass(realtimeStatus))} aria-hidden />
              {REALTIME_TEXT[realtimeStatus]}
            </span>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && <span className="text-xs text-fg-muted">{unreadCount} 条未读</span>}
              <Button
                size="xs"
                variant="ghost"
                icon={<CheckCheck className="size-3.5" />}
                disabled={unreadCount === 0 || markRead.isPending}
                onClick={markAll}
              >
                全部标为已读
              </Button>
            </div>
          </header>

          {isLoading ? (
            <div className="p-3">
              <ListSkeleton rows={6} />
            </div>
          ) : isError ? (
            <ErrorState className="py-10" onRetry={() => void refetch()} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Bell className="size-7" />}
              title="暂无通知"
              description={
                type === 'ALL'
                  ? '点赞、评论、关注与审核结果都会出现在这里。'
                  : `暂时没有「${FILTER_LABELS[type]}」类型的通知。`
              }
            />
          ) : (
            <ul>
              {items.map((item) => {
                const Icon = NOTIFICATION_ICONS[item.type];
                return (
                  <li
                    key={item.id}
                    className="flex items-start gap-3 border-b border-line px-3.5 py-3 last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => openNotification(item)}
                      className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    >
                      {item.actor ? (
                        <Avatar src={item.actor.avatar} name={item.actor.nickname} size="sm" />
                      ) : (
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                          <Icon className="size-4" aria-hidden />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] font-medium text-fg">{item.title}</span>
                          {!item.isRead && (
                            <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-label="未读" />
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">
                          {item.actor ? `${item.actor.nickname}：` : ''}
                          {item.content}
                        </span>
                        <span className="mt-1 flex items-center gap-1.5 text-[11px] text-fg-subtle">
                          <Icon className="size-3" aria-hidden />
                          {FILTER_LABELS[item.type]} · {formatRelative(item.createdAt)}
                        </span>
                      </span>
                    </button>
                    {!item.isRead && (
                      <Button size="xs" variant="ghost" className="shrink-0" onClick={() => markOne(item.id)}>
                        标为已读
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </SurfaceCard>

        <Pagination
          className="mt-4"
          page={page}
          total={data?.total ?? 0}
          pageSize={NOTIFICATION_PAGE_SIZE}
          onChange={setPage}
        />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 私信 */

function MessageSection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, isLoading, isError, refetch } = useConversations();
  const conversations = useMemo(() => data ?? [], [data]);
  const [pickedId, setPickedId] = useState<number | null>(() => {
    const raw = Number(searchParams.get('c') ?? 0);
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  });
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState<DirectMessage['attachment']>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const uploadAttachment = useUploadMessageAttachment();

  /** ?c= 未指定或返回列表（0）时落到第一个会话 */
  const selectedId = pickedId ?? conversations[0]?.id ?? 0;

  const client = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id ?? 0);
  const toast = useUiStore((s) => s.toast);
  const thread = useMessages(selectedId);
  const send = useSendMessage(selectedId);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);

  const messages = useMemo(() => thread.data ?? [], [thread.data]);
  const selected = conversations.find((item) => item.id === selectedId) ?? null;

  // 新消息到达后滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [selectedId, messages.length]);

  function syncUrl(conversationId: number | null) {
    const params = new URLSearchParams(searchParams);
    params.set('tab', 'message');
    if (conversationId === null) params.delete('c');
    else params.set('c', String(conversationId));
    setSearchParams(params, { replace: true });
  }

  function selectConversation(conversationId: number) {
    setPickedId(conversationId);
    syncUrl(conversationId);
  }

  function backToList() {
    syncUrl(null);
    setPickedId(0);
  }

  function handleSend() {
    const content = draft.trim();
    // 允许「只有附件」的消息：只要有正文或附件之一即可发送
    const hasAttachment = attachment !== null;
    if ((!content && !hasAttachment) || selectedId <= 0 || sendingRef.current || send.isPending) return;
    sendingRef.current = true;
    const key = queryKeys.messages.thread(selectedId);
    const previous = client.getQueryData<DirectMessage[]>(key);
    const optimistic: DirectMessage = {
      id: temporaryNumericId(),
      conversationId: selectedId,
      senderId: myId,
      content,
      attachment,
      createdAt: new Date().toISOString(),
      mine: true,
      pending: true,
    };
    if (previous) client.setQueryData<DirectMessage[]>(key, [...previous, optimistic]);
    setDraft('');
    setAttachment(null);
    send.mutate({ content, attachment }, {
      onSuccess: () => {
        sendingRef.current = false;
      },
      onError: () => {
        sendingRef.current = false;
        if (previous) client.setQueryData<DirectMessage[]>(key, previous);
        toast({ title: '消息发送失败，请稍后重试', tone: 'error' });
      },
    });
  }

  /**
   * 选择本地文件后先上传到对象存储，拿到 URL 再作为待发送附件。
   * 这样发送的消息里保存的是一条可访问地址，而不是用户本地路径。
   */
  async function uploadAttachmentFile(file: File) {
    // 先做一次前端预检，避免把明显超限的文件传上去浪费带宽
    const isVideo = file.type.startsWith('video/');
    const limitMb = isVideo ? 50 : 5;
    if (!file.type.startsWith('image/') && !isVideo) {
      toast({ title: '只支持图片或视频', tone: 'warning' });
      return;
    }
    if (file.size > limitMb * 1024 * 1024) {
      toast({ title: `文件过大`, description: `${isVideo ? '视频' : '图片'}不能超过 ${limitMb}MB`, tone: 'warning' });
      return;
    }
    try {
      const uploaded = await uploadAttachment.mutateAsync(file);
      setAttachment(uploaded);
      toast({ title: '附件已添加', description: '发送消息后附件会随消息保存。', tone: 'success' });
    } catch (error) {
      toast({
        title: '附件上传失败',
        description: error instanceof Error ? error.message : '请稍后重试',
        tone: 'error',
      });
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      {/* 会话列表：移动端选中会话后隐藏 */}
      <SurfaceCard
        padded={false}
        className={cn(
          'flex h-[calc(100dvh-21rem)] min-h-[20rem] flex-col overflow-hidden lg:h-[calc(100dvh-17rem)]',
          selected && 'hidden lg:flex',
        )}
      >
        <header className="border-b border-line px-3.5 py-2.5">
          <h2 className="text-sm font-semibold text-fg">会话</h2>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-3">
              <ListSkeleton rows={6} />
            </div>
          ) : isError ? (
            <ErrorState className="py-10" onRetry={() => void refetch()} />
          ) : conversations.length === 0 ? (
            <EmptyState
              compact
              icon={<MessageCircle className="size-5" />}
              title="还没有私信，去关注感兴趣的人吧"
              description="在创作者主页点击关注，就能在私信里继续交流。"
              action={
                <Link to="/">
                  <Button size="sm" variant="secondary">
                    回首页逛逛
                  </Button>
                </Link>
              }
            />
          ) : (
            <ul>
              {conversations.map((item) => {
                const active = item.id === selectedId;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={active ? 'true' : undefined}
                      onClick={() => selectConversation(item.id)}
                      className={cn(
                        'flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors',
                        active ? 'bg-surface-2' : 'hover:bg-surface-2',
                      )}
                    >
                      <Avatar src={item.peer.avatar} name={item.peer.nickname} size="md" certified={item.peer.certified} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">
                            {item.peer.nickname}
                          </span>
                          <span className="shrink-0 text-[11px] text-fg-subtle">
                            {formatRelative(item.lastMessageAt)}
                          </span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{item.lastMessage}</span>
                          {item.unreadCount > 0 && (
                            <Badge tone="brand">{item.unreadCount > 99 ? '99+' : item.unreadCount}</Badge>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SurfaceCard>

      {/* 对话区：移动端未选中会话时隐藏 */}
      <SurfaceCard
        padded={false}
        className={cn(
          'flex h-[calc(100dvh-21rem)] min-h-[20rem] flex-col overflow-hidden lg:h-[calc(100dvh-17rem)]',
          !selected && 'hidden lg:flex',
        )}
      >
        {!selected ? (
          <div className="grid h-full place-items-center px-4">
            <EmptyState
              compact
              icon={<MessageSquare className="size-5" />}
              title="选择一个会话"
              description="左侧列表中的会话会显示在这里。"
            />
          </div>
        ) : (
          <>
            <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
              <IconButton label="返回会话列表" size="icon-sm" className="lg:hidden" onClick={backToList}>
                <ArrowLeft className="size-4" />
              </IconButton>
              <Avatar src={selected.peer.avatar} name={selected.peer.nickname} size="sm" certified={selected.peer.certified} />
              <Link
                to={`/user/${selected.peer.id}`}
                className="min-w-0 truncate text-sm font-medium text-fg hover:text-accent"
              >
                {selected.peer.nickname}
              </Link>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
              {thread.isLoading ? (
                <ListSkeleton rows={5} />
              ) : thread.isError ? (
                <ErrorState className="py-10" onRetry={() => void thread.refetch()} />
              ) : messages.length === 0 ? (
                <EmptyState compact title="还没有消息" description="发一条消息打个招呼吧。" />
              ) : (
                <div className="flex flex-col gap-2.5">
                  {messages.map((message, index) => {
                    const previous = index > 0 ? messages[index - 1] : null;
                    const withDivider =
                      !previous ||
                      dayjs(message.createdAt).diff(dayjs(previous.createdAt), 'minute') > TIME_DIVIDER_MINUTES;
                    return (
                      <div key={message.id} className="flex flex-col gap-2.5">
                        {withDivider && (
                          <span className="self-center text-[11px] text-fg-subtle">
                            {formatRelative(message.createdAt)}
                          </span>
                        )}
                        <div className={cn('flex items-end gap-2', message.mine ? 'justify-end' : 'justify-start')}>
                          {!message.mine && (
                            <Avatar src={selected.peer.avatar} name={selected.peer.nickname} size="sm" />
                          )}
                          <div
                            className={cn(
                              'max-w-[78%] rounded-card px-3 py-2 text-sm leading-relaxed break-words',
                              message.mine ? 'bg-accent text-white' : 'bg-surface-2 text-fg',
                              message.pending && 'opacity-70',
                            )}
                          >
                            {/* 纯附件消息正文为空，不渲染空文本节点，也避免多余的上间距 */}
                            {message.content && <span>{message.content}</span>}
                            {message.attachment?.type === 'IMAGE' && (
                              <img
                                src={message.attachment.url}
                                alt="消息图片"
                                className={cn('max-h-48 max-w-full rounded', message.content && 'mt-2')}
                              />
                            )}
                            {message.attachment?.type === 'VIDEO' && (
                              <a
                                href={message.attachment.url}
                                target="_blank"
                                rel="noreferrer"
                                className={cn('block text-[11px] underline', message.content && 'mt-1')}
                              >
                                打开视频附件
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="border-t border-line p-3">
              <Textarea
                aria-label="消息输入框"
                rows={2}
                maxLength={MESSAGE_MAX_LENGTH}
                value={draft}
                placeholder="输入消息，回车发送，Shift + 回车换行"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  /*
                   * 回车发送：有正文或有附件都算「可发送」。
                   * 两者都没有时不拦截回车，让输入框保持正常换行行为。
                   */
                  const canSend = draft.trim().length > 0 || attachment !== null;
                  if (canSend && event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    handleSend();
                  }
                }}
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  {/*
                    改为真正的文件选择 + 上传：此前用 window.prompt 只收 http/https 地址，
                    用户无法发送本地图片或视频。
                  */}
                  <IconButton
                    label="发送图片"
                    size="icon-sm"
                    disabled={uploadAttachment.isPending}
                    onClick={() => imageInputRef.current?.click()}
                  >
                    <ImageIcon className="size-4" />
                  </IconButton>
                  <IconButton
                    label="发送视频"
                    size="icon-sm"
                    disabled={uploadAttachment.isPending}
                    onClick={() => videoInputRef.current?.click()}
                  >
                    <Video className="size-4" />
                  </IconButton>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    className="sr-only"
                    aria-label="选择图片文件"
                    onChange={(event) => {
                      const picked = event.target.files?.[0];
                      if (picked) void uploadAttachmentFile(picked);
                      event.target.value = '';
                    }}
                  />
                  <input
                    ref={videoInputRef}
                    type="file"
                    accept="video/mp4,video/quicktime,video/webm"
                    className="sr-only"
                    aria-label="选择视频文件"
                    onChange={(event) => {
                      const picked = event.target.files?.[0];
                      if (picked) void uploadAttachmentFile(picked);
                      event.target.value = '';
                    }}
                  />
                  <span className="ml-1 text-[11px] text-fg-subtle">
                    {uploadAttachment.isPending ? '附件上传中…' : attachment ? '附件已就绪，发送后随消息保存' : '支持图片（5MB）、视频（50MB）'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] tabular-nums text-fg-subtle">
                    {draft.length}/{MESSAGE_MAX_LENGTH}
                  </span>
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Send className="size-3.5" />}
                    disabled={draft.trim().length === 0 && attachment === null}
                    loading={send.isPending}
                    onClick={handleSend}
                  >
                    发送
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </SurfaceCard>
    </div>
  );
}
