import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, Flag, Heart, MessageSquare, Send, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatCount, formatRelative } from '@/lib/format';
import { COMMENT_MAX_LENGTH, COMMENT_PAGE_SIZE, REPLY_PREVIEW_COUNT } from '@/lib/constants';
import type { CommentItem, CommentQuery } from '@/api/types';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import {
  useCommentReplies,
  useComments,
  useDeleteComment,
  useLikeComment,
  usePostComment,
  useReplyComment,
} from '@/hooks/useApi';
import { Avatar, Button, CommentSkeleton, EmptyState, Tabs, Textarea } from '@/components/ui';
import { ReportDialog } from '@/components/video/ReportDialog';

const SORTS: { key: NonNullable<CommentQuery['sort']>; label: string }[] = [
  { key: 'hot', label: '最热' },
  { key: 'new', label: '最新' },
];

/** 虚拟列表阈值（文档 5.6：评论 > 200 条启用 @tanstack/react-virtual） */
const VIRTUAL_THRESHOLD = 200;

export interface CommentSectionProps {
  videoId: number;
  commentCount: number;
  /** 视频作者 id，用于「作者」标识 */
  authorId: number;
  className?: string;
}

export function CommentSection({ videoId, commentCount, authorId, className }: CommentSectionProps) {
  const [sort, setSort] = useState<NonNullable<CommentQuery['sort']>>('hot');
  const [page, setPage] = useState(1);
  const isLogin = useAuthStore((s) => s.status === 'authenticated');

  const query = useMemo<CommentQuery>(() => ({ sort, page, pageSize: COMMENT_PAGE_SIZE }), [sort, page]);
  const { data, isLoading, isError, refetch } = useComments(videoId, query);
  const postComment = usePostComment(videoId, query);

  const items = data?.items ?? [];
  const total = data?.total ?? commentCount;

  return (
    <section className={cn('flex flex-col gap-5', className)} aria-label="评论区">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-fg">
          评论 <span className="ml-1 text-sm font-normal tabular-nums text-fg-muted">{formatCount(total)}</span>
        </h2>
        <Tabs
          items={SORTS}
          value={sort}
          onChange={(next) => {
            setSort(next);
            setPage(1);
          }}
          variant="segment"
          size="sm"
        />
      </header>

      <CommentInput
        disabled={!isLogin}
        pending={postComment.isPending}
        onSubmit={async (content) => {
          await postComment.mutateAsync(content);
          setPage(1);
        }}
      />

      {isLoading ? (
        <CommentSkeleton count={4} />
      ) : isError ? (
        <EmptyState
          compact
          title="评论加载失败"
          description="网络似乎不太稳定，点击下方按钮重试。"
          action={
            <Button size="sm" variant="secondary" onClick={() => void refetch()}>
              重新加载
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          compact
          title="还没有评论"
          description={isLogin ? '来说点什么吧，友善的讨论能让更多人受益。' : '登录后即可参与讨论。'}
        />
      ) : items.length > VIRTUAL_THRESHOLD ? (
        <VirtualCommentList
          items={items}
          authorId={authorId}
          videoId={videoId}
          sort={sort}
          onReachEnd={() => {
            if (data?.hasMore) setPage((p) => p + 1);
          }}
        />
      ) : (
        <ul className="flex flex-col gap-6">
          {items.map((item) => (
            <CommentRow key={item.id} comment={item} authorId={authorId} videoId={videoId} sort={sort} />
          ))}
        </ul>
      )}

      {data?.hasMore && items.length <= VIRTUAL_THRESHOLD && (
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => setPage((p) => p + 1)}>
            加载更多评论
          </Button>
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------- 输入框 */

export function CommentInput({
  disabled,
  pending,
  onSubmit,
  placeholder = '发一条友善的评论',
  autoFocus,
  onCancel,
  compact,
}: {
  disabled?: boolean;
  pending?: boolean;
  onSubmit: (content: string) => Promise<void> | void;
  placeholder?: string;
  autoFocus?: boolean;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const user = useAuthStore((s) => s.user);
  const toast = useUiStore((s) => s.toast);

  const submit = async () => {
    const content = value.trim();
    if (!content) return;
    if (!user) {
      toast({ title: '请先登录后再评论', tone: 'warning' });
      return;
    }
    await onSubmit(content);
    setValue('');
    setFocused(false);
  };

  return (
    <div className="flex gap-3">
      <Avatar src={user?.avatar} name={user?.nickname ?? '游客'} size={compact ? 'sm' : 'md'} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <Textarea
          value={value}
          rows={focused || value.length > 0 ? 3 : 1}
          maxLength={COMMENT_MAX_LENGTH}
          autoFocus={autoFocus}
          disabled={disabled}
          placeholder={disabled ? '登录后即可发表评论' : placeholder}
          onFocus={() => setFocused(true)}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void submit();
          }}
          className={cn('transition-[min-height] duration-200', compact && 'text-[13px]')}
          footer={
            <>
              <span className="text-[11px] tabular-nums text-fg-subtle">
                {value.length}/{COMMENT_MAX_LENGTH} · 评论需遵守社区规范
              </span>
              <span className="flex items-center gap-2">
                {onCancel && (
                  <Button size="xs" variant="ghost" onClick={onCancel}>
                    取消
                  </Button>
                )}
                <Button
                  size="xs"
                  variant="primary"
                  loading={pending}
                  disabled={!value.trim()}
                  icon={<Send className="size-3.5" />}
                  onClick={() => void submit()}
                >
                  发布
                </Button>
              </span>
            </>
          }
        />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- 单条评论 */

function CommentRow({
  comment,
  authorId,
  videoId,
  sort,
  isReply,
}: {
  comment: CommentItem;
  authorId: number;
  videoId: number;
  sort: NonNullable<CommentQuery['sort']>;
  isReply?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [replying, setReplying] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const currentUser = useAuthStore((s) => s.user);
  const likeComment = useLikeComment(videoId);
  const replyComment = useReplyComment(videoId);
  const deleteComment = useDeleteComment(videoId);
  const openConfirm = useUiStore((s) => s.openConfirm);

  const { data: repliesPage } = useCommentReplies(comment.id, expanded, 1);
  const replies = expanded ? (repliesPage?.items ?? comment.replies ?? []) : (comment.replies ?? []);
  const hiddenReplyCount = Math.max(0, comment.replyCount - replies.length);

  const isAuthor = comment.user.id === authorId;
  const isMine = currentUser?.id === comment.user.id;

  return (
    <li className={cn('flex gap-3', comment.pending && 'comment-highlight rounded-btn px-1')}>
      <Link to={`/user/${comment.user.id}`} className="shrink-0">
        <Avatar
          src={comment.user.avatar}
          name={comment.user.nickname}
          size={isReply ? 'xs' : 'sm'}
          certified={comment.user.certified}
        />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link to={`/user/${comment.user.id}`} className="text-[13px] font-medium text-fg hover:text-accent">
            {comment.user.nickname}
          </Link>
          {(isAuthor || comment.isVideoAuthor) && (
            <span className="rounded-[4px] bg-brand-soft px-1.5 py-px text-[10px] font-medium text-brand">作者</span>
          )}
          <span className="text-[11px] text-fg-subtle">{formatRelative(comment.createdAt)}</span>
          {comment.pending && <span className="text-[11px] text-fg-subtle">发送中…</span>}
        </div>

        <p className="mt-1 text-[13px] leading-[1.7] whitespace-pre-wrap break-words text-fg">{comment.content}</p>

        <div className="mt-1.5 flex items-center gap-1">
          <button
            type="button"
            onClick={() => likeComment.mutate({ commentId: comment.id, active: !comment.liked })}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-pill px-2 text-[11px] transition-colors hover:bg-surface-2',
              comment.liked ? 'text-brand' : 'text-fg-subtle hover:text-fg',
            )}
          >
            <Heart className={cn('size-3.5', comment.liked && 'fill-current')} />
            {comment.likeCount > 0 && <span className="tabular-nums">{formatCount(comment.likeCount)}</span>}
          </button>

          {!isReply && (
            <button
              type="button"
              onClick={() => setReplying((v) => !v)}
              className="inline-flex h-7 items-center gap-1 rounded-pill px-2 text-[11px] text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
            >
              <MessageSquare className="size-3.5" />
              回复
            </button>
          )}

          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="inline-flex h-7 items-center gap-1 rounded-pill px-2 text-[11px] text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <Flag className="size-3.5" />
            举报
          </button>

          {isMine && (
            <button
              type="button"
              onClick={() =>
                openConfirm({
                  title: '删除这条评论？',
                  description: '删除后无法恢复，回复内容也会一并移除。',
                  confirmText: '删除',
                  danger: true,
                  onConfirm: () => deleteComment.mutate(comment.id),
                })
              }
              className="inline-flex h-7 items-center gap-1 rounded-pill px-2 text-[11px] text-fg-subtle transition-colors hover:bg-surface-2 hover:text-brand"
            >
              <Trash2 className="size-3.5" />
              删除
            </button>
          )}
        </div>

        {replying && (
          <div className="mt-3">
            <CommentInput
              compact
              autoFocus
              placeholder={`回复 @${comment.user.nickname}`}
              pending={replyComment.isPending}
              onCancel={() => setReplying(false)}
              onSubmit={async (content) => {
                await replyComment.mutateAsync({ commentId: comment.id, content });
                setReplying(false);
                setExpanded(true);
              }}
            />
          </div>
        )}

        {/* 楼中楼 */}
        {!isReply && (comment.replyCount > 0 || replies.length > 0) && (
          <div className="mt-3 flex flex-col gap-3 border-l-2 border-line pl-3">
            {replies.slice(0, expanded ? undefined : REPLY_PREVIEW_COUNT).map((reply) => (
              <ul key={reply.id}>
                <CommentRow comment={reply} authorId={authorId} videoId={videoId} sort={sort} isReply />
              </ul>
            ))}
            {(hiddenReplyCount > 0 || comment.replyCount > REPLY_PREVIEW_COUNT) && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="inline-flex items-center gap-1 self-start text-[11px] font-medium text-accent hover:underline"
              >
                <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />
                {expanded ? '收起回复' : `展开 ${hiddenReplyCount || comment.replyCount} 条回复`}
              </button>
            )}
          </div>
        )}
      </div>

      <ReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType="COMMENT"
        targetId={comment.id}
        targetTitle={comment.content.slice(0, 40)}
      />
    </li>
  );
}

/* ------------------------------------------------------- 虚拟滚动列表 */

function VirtualCommentList({
  items,
  authorId,
  videoId,
  sort,
  onReachEnd,
}: {
  items: CommentItem[];
  authorId: number;
  videoId: number;
  sort: NonNullable<CommentQuery['sort']>;
  onReachEnd: () => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  // react-hooks/incompatible-library：useVirtualizer 返回的函数无法被编译器安全记忆化，
  // 这是 TanStack Virtual 的已知限制，不影响运行正确性，此处显式说明。
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 6,
  });

  useEffect(() => {
    const last = virtualizer.getVirtualItems().at(-1);
    if (last && last.index >= items.length - 3) onReachEnd();
  }, [virtualizer, items.length, onReachEnd]);

  return (
    <div ref={parentRef} className="max-h-[720px] overflow-y-auto pr-1">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={items[row.index].id}
            ref={virtualizer.measureElement}
            data-index={row.index}
            className="absolute inset-x-0 top-0 pb-6"
            style={{ transform: `translateY(${row.start}px)` }}
          >
            <ul>
              <CommentRow comment={items[row.index]} authorId={authorId} videoId={videoId} sort={sort} />
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
