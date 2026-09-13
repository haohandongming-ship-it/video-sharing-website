/**
 * 个人主页（文档 3.1：头像 / 简介 / 作品 / 动态 / 收藏 / 关注列表）
 * Tab 状态同步到 URL 的 ?tab=，便于分享与刷新保持。
 */
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BadgeCheck, CalendarDays, Settings2, UserRoundX } from 'lucide-react';
import { ApiError } from '@/api/client';
import type { FollowUser } from '@/api/types';
import {
  Avatar,
  AvatarWithMeta,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  ListSkeleton,
  PageContainer,
  Pagination,
  Skeleton,
  Tabs,
  VideoCardGrid,
  VideoGridSkeleton,
  type TabItem,
} from '@/components/ui';
import { FeedCard } from '@/components/feed/FeedCard';
import { SubscribeButton } from '@/components/user/SubscribeButton';
import {
  useFollowList,
  useToggleFollow,
  useUserFavorites,
  useUserFeeds,
  useUserProfile,
  useUserVideos,
} from '@/hooks/useApi';
import { formatCount, formatDate } from '@/lib/format';
import { useAuthStore } from '@/stores/authStore';

const TAB_KEYS = ['videos', 'feeds', 'favorites', 'following', 'followers'] as const;
type ProfileTab = (typeof TAB_KEYS)[number];

/**
 * 封面底色：surface 层级叠层 + 品牌珊瑚红低透明度光斑，
 * 不用图片资源，也不使用紫蓝渐变。
 */
const COVER_BACKGROUND = [
  'radial-gradient(120% 160% at 6% -12%, var(--c-brand-soft) 0%, transparent 56%)',
  'radial-gradient(90% 130% at 94% 4%, var(--c-surface-3) 0%, transparent 62%)',
  'linear-gradient(112deg, var(--c-surface-2) 0%, var(--c-surface-3) 56%, var(--c-surface-2) 100%)',
].join(', ');

export default function UserProfilePage() {
  const { id } = useParams<{ id: string }>();
  const idParam = (id ?? '').trim();
  const userId = Number(idParam);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const profileQuery = useUserProfile(userId);
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const follow = useToggleFollow();

  const rawTab = searchParams.get('tab');
  const tab: ProfileTab = (TAB_KEYS as readonly string[]).includes(rawTab ?? '')
    ? (rawTab as ProfileTab)
    : 'videos';

  /** 路由参数尚未就绪：按加载态处理，避免误判成「用户不存在」 */
  const paramPending = idParam === '';
  const invalidId = !paramPending && (!Number.isFinite(userId) || userId <= 0);

  const changeTab = (next: ProfileTab) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  if (paramPending) return <ProfileSkeleton />;

  if (invalidId || (profileQuery.isError && profileQuery.error instanceof ApiError && profileQuery.error.isNotFound)) {
    return (
      <PageContainer className="py-12">
        <EmptyState
          icon={<UserRoundX className="size-7" aria-hidden />}
          title="用户不存在"
          description="该账号可能已注销，或者链接里的地址有误。"
          action={
            <Link to="/">
              <Button variant="primary">返回首页</Button>
            </Link>
          }
        />
      </PageContainer>
    );
  }

  if (profileQuery.isPending) return <ProfileSkeleton />;

  if (profileQuery.isError || !profileQuery.data) {
    return (
      <PageContainer className="py-12">
        <ErrorState
          title="资料加载失败"
          description="没能取到这位用户的资料，请检查网络后重试。"
          onRetry={() => void profileQuery.refetch()}
        />
      </PageContainer>
    );
  }

  const profile = profileQuery.data;
  const isSelf = currentUserId !== null && currentUserId === profile.id;

  const tabItems: TabItem<ProfileTab>[] = [
    { key: 'videos', label: '作品', count: profile.videoCount },
    { key: 'feeds', label: '动态' },
    { key: 'favorites', label: '收藏' },
    { key: 'following', label: '关注', count: profile.followingCount },
    { key: 'followers', label: '粉丝', count: profile.followerCount },
  ];

  return (
    <PageContainer className="pt-4 pb-12">
      {/* 封面区：纯 CSS 渐变 + 几何图形 */}
      <div
        aria-hidden
        className="relative h-40 overflow-hidden rounded-card border border-line sm:h-48"
        style={{ background: COVER_BACKGROUND }}
      >
        <span className="absolute -top-12 -left-8 size-44 rotate-[18deg] rounded-[40px] border border-line bg-surface-2/60" />
        <span className="absolute top-6 left-[38%] size-20 rounded-full bg-brand-soft" />
        <span className="absolute -right-10 -bottom-20 size-52 rotate-[12deg] rounded-[48px] bg-surface-3/70" />
        <span className="absolute right-[22%] bottom-5 h-px w-24 bg-line" />
      </div>

      {/* 资料区 */}
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <Avatar
            src={profile.avatar}
            name={profile.nickname}
            size="2xl"
            certified={profile.certified}
            className="-mt-12 shrink-0 rounded-full ring-4 ring-canvas sm:-mt-14"
          />
          <div className="min-w-0 pt-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-lg font-semibold text-fg sm:text-xl">{profile.nickname}</h1>
              {profile.certified && (
                <Badge tone="accent" icon={<BadgeCheck className="size-3" aria-hidden />}>
                  已认证创作者
                </Badge>
              )}
              {profile.realNameStatus === 'CERTIFIED' && (
                <Badge tone="success">已实名认证创作者</Badge>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-fg-subtle">@{profile.username}</p>
            {profile.bio && (
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-muted">{profile.bio}</p>
            )}
            <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-fg-subtle">
              <CalendarDays className="size-3.5" aria-hidden />
              {formatDate(profile.createdAt)} 加入
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isSelf ? (
            <>
              <Button
                variant="outline"
                icon={<Settings2 className="size-4" aria-hidden />}
                onClick={() => navigate('/settings')}
              >
                编辑资料
              </Button>
              <Button variant="ghost" onClick={() => navigate('/creator')}>
                创作中心
              </Button>
            </>
          ) : (
            <SubscribeButton
              active={profile.followed}
              mutual={profile.mutual}
              loading={follow.isPending}
              onToggle={(next) => follow.mutate({ userId: profile.id, active: next })}
            />
          )}
        </div>
      </div>

      {/* 统计行 */}
      <dl className="mt-5 grid max-w-lg grid-cols-4 gap-3 border-y border-line py-3">
        <ProfileStat label="作品" value={profile.videoCount} />
        <ProfileStat label="粉丝" value={profile.followerCount ?? 0} />
        <ProfileStat label="关注" value={profile.followingCount} />
        <ProfileStat label="获赞" value={profile.totalLikes} />
      </dl>

      {/* 内容 Tab */}
      <Tabs
        items={tabItems}
        value={tab}
        onChange={changeTab}
        variant="underline"
        scrollable
        className="mt-4"
      />

      <div className="mt-6 min-h-[320px]">
        {tab === 'videos' && <VideosTab userId={profile.id} />}
        {tab === 'feeds' && <FeedsTab userId={profile.id} />}
        {tab === 'favorites' && <FavoritesTab userId={profile.id} isSelf={isSelf} />}
        {tab === 'following' && <FollowTab userId={profile.id} kind="following" />}
        {tab === 'followers' && <FollowTab userId={profile.id} kind="followers" />}
      </div>
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ 统计 */

function ProfileStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-fg" title={`${value}`}>
        {formatCount(value)}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------ 作品 */

function VideosTab({ userId }: { userId: number }) {
  const [page, setPage] = useState(1);
  const query = useUserVideos(userId, page);

  if (query.isPending) return <VideoGridSkeleton count={6} />;
  if (query.isError) return <ErrorState title="作品加载失败" onRetry={() => void query.refetch()} />;

  const data = query.data;
  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        title="还没有发布作品"
        description="这位创作者还没有公开的视频，可以先看看 TA 发布的动态。"
      />
    );
  }

  return (
    <>
      <VideoCardGrid videos={data.items} columns={3} />
      <Pagination
        page={data.page}
        total={data.total}
        pageSize={data.pageSize}
        onChange={setPage}
        className="mt-8"
      />
    </>
  );
}

/* ------------------------------------------------------------------ 动态 */

function FeedsTab({ userId }: { userId: number }) {
  const [page, setPage] = useState(1);
  const query = useUserFeeds(userId, page);

  if (query.isPending) return <ListSkeleton rows={4} />;
  if (query.isError) return <ErrorState title="动态加载失败" onRetry={() => void query.refetch()} />;

  const data = query.data;
  if (!data || data.items.length === 0) {
    return <EmptyState title="还没有发布动态" description="图文、转发与话题讨论都会出现在这里。" />;
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        {data.items.map((post) => (
          <FeedCard key={post.id} post={post} />
        ))}
      </div>
      <Pagination
        page={data.page}
        total={data.total}
        pageSize={data.pageSize}
        onChange={setPage}
        className="mt-8"
      />
    </>
  );
}

/* ------------------------------------------------------------------ 收藏 */

function FavoritesTab({ userId, isSelf }: { userId: number; isSelf: boolean }) {
  const [page, setPage] = useState(1);
  const query = useUserFavorites(userId, page);

  if (query.isPending) return <VideoGridSkeleton count={6} />;
  if (query.isError) return <ErrorState title="收藏加载失败" onRetry={() => void query.refetch()} />;

  const data = query.data;
  // 接口未下发「收藏是否公开」标记：列表为空时统一按「没有公开收藏」处理。
  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        title={isSelf ? '你还没有收藏视频' : 'TA 没有公开的收藏'}
        description={
          isSelf
            ? '在播放页点「收藏」，视频就会收进这里，方便之后再找。'
            : '对方可能把收藏设为仅自己可见，也可能还没有收藏内容。'
        }
        action={
          isSelf ? (
            <Link to="/">
              <Button variant="primary">去首页看看</Button>
            </Link>
          ) : undefined
        }
      />
    );
  }

  return (
    <>
      <VideoCardGrid videos={data.items} columns={3} />
      <Pagination
        page={data.page}
        total={data.total}
        pageSize={data.pageSize}
        onChange={setPage}
        className="mt-8"
      />
    </>
  );
}

/* ------------------------------------------------------------ 关注 / 粉丝 */

function FollowTab({ userId, kind }: { userId: number; kind: 'following' | 'followers' }) {
  const [page, setPage] = useState(1);
  const query = useFollowList(userId, kind, page);

  if (query.isPending) return <ListSkeleton rows={6} />;
  if (query.isError) return <ErrorState title="列表加载失败" onRetry={() => void query.refetch()} />;

  const data = query.data;
  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        title={kind === 'following' ? '还没有关注任何人' : '还没有粉丝'}
        description={
          kind === 'following'
            ? '关注的创作者会出现在这里，方便随时回看他们的更新。'
            : '发布作品并参与互动之后，这里会慢慢有人。'
        }
      />
    );
  }

  return (
    <>
      <ul className="flex flex-col">
        {data.items.map((user) => (
          <li key={user.id}>
            <FollowRow user={user} />
          </li>
        ))}
      </ul>
      <Pagination
        page={data.page}
        total={data.total}
        pageSize={data.pageSize}
        onChange={setPage}
        className="mt-8"
      />
    </>
  );
}

function FollowRow({ user }: { user: FollowUser }) {
  const follow = useToggleFollow();
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const isSelf = currentUserId === user.id;

  return (
    <div className="flex items-start justify-between gap-3 border-b border-line py-4 last:border-b-0">
      <Link to={`/user/${user.id}`} className="min-w-0 flex-1">
        <AvatarWithMeta
          src={user.avatar}
          name={user.nickname}
          size="md"
          certified={user.certified}
          meta={`@${user.username}${
            user.followerCount ? ` · ${formatCount(user.followerCount)} 粉丝` : ''
          }`}
        />
        {user.bio && (
          <p className="mt-1.5 line-clamp-2 pl-11 text-xs leading-relaxed text-fg-muted">{user.bio}</p>
        )}
        <p className="mt-1 pl-11 text-[11px] text-fg-subtle">
          {user.followedAt ? `${formatDate(user.followedAt)} 关注` : '已关注'}
        </p>
      </Link>
      {!isSelf && (
        <SubscribeButton
          size="sm"
          active={user.followed}
          mutual={user.mutual}
          loading={follow.isPending}
          onToggle={(next) => follow.mutate({ userId: user.id, active: next })}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- 骨架屏 */

function ProfileSkeleton() {
  return (
    <PageContainer className="pt-4 pb-12">
      <Skeleton className="h-40 w-full sm:h-48" rounded="lg" />
      <div className="mt-4 flex items-start gap-4">
        <Skeleton className="-mt-12 size-24 shrink-0" rounded="full" />
        <div className="flex min-w-0 flex-1 flex-col gap-2.5 pt-1">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-full max-w-md" />
        </div>
      </div>
      <div className="mt-5 grid max-w-lg grid-cols-4 gap-3 border-y border-line py-3">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-9" />
        ))}
      </div>
      <Skeleton className="mt-4 h-8 w-full max-w-md" />
      <div className="mt-6">
        <VideoGridSkeleton count={3} />
      </div>
    </PageContainer>
  );
}
