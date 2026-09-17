import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Filter, Search, SlidersHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatCount, formatRelative } from '@/lib/format';
import { useCategories, useUserSearch, useVideoSearch } from '@/hooks/useApi';
import { useUiStore } from '@/stores/uiStore';
import {
  AvatarWithMeta,
  Button,
  EmptyState,
  ErrorState,
  PageContainer,
  Pagination,
  SearchInput,
  Tabs,
  VideoCardSkeleton,
} from '@/components/ui';
import { VideoCard } from '@/components/video/VideoCard';
import type { SearchQuery, UserBrief, VideoSummary } from '@/api/types';

type SearchKind = 'video' | 'user' | 'feed';
type SortKey = NonNullable<SearchQuery['sort']>;
type DurationKey = NonNullable<SearchQuery['duration']>;
type DateKey = NonNullable<SearchQuery['dateRange']>;

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'relevance', label: '综合排序' },
  { key: 'latest', label: '最新发布' },
  { key: 'views', label: '播放最多' },
];

const DURATIONS: { key: DurationKey | 'all'; label: string }[] = [
  { key: 'all', label: '全部时长' },
  { key: 'short', label: '5 分钟以内' },
  { key: 'medium', label: '5 - 30 分钟' },
  { key: 'long', label: '30 分钟以上' },
];

const DATE_RANGES: { key: DateKey; label: string }[] = [
  { key: 'all', label: '不限时间' },
  { key: 'day', label: '一天内' },
  { key: 'week', label: '一周内' },
  { key: 'month', label: '一月内' },
];

const HOT_KEYWORDS = ['架构设计', 'React 19', '家常菜', '骑行', '独立游戏', '租房改造', '远程办公'];

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useUiStore((s) => s.toast);

  const q = params.get('q') ?? '';
  /*
   * 归一化关键词里的 @ 前缀：用户按「@laowang」搜索时，@ 会参与 LIKE 匹配，
   * 而库里存的用户名不含 @，导致搜不到。这里统一剥掉前导 @（可多个），
   * 视频/创作者/动态三个标签共用同一个清洗后的关键词。
   */
  const term = q.trim().replace(/^@+/, '');
  const kind = (params.get('type') as SearchKind | null) ?? 'video';
  const categoryId = params.get('category') ? Number(params.get('category')) : undefined;
  const duration = (params.get('duration') as DurationKey | null) ?? undefined;
  const dateRange = (params.get('dateRange') as DateKey | null) ?? 'all';
  const sort = (params.get('sort') as SortKey | null) ?? 'relevance';
  const page = Number(params.get('page') ?? 1);

  const [input, setInput] = useState(q);
  const [history, setHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('vs-search-history') ?? '[]') as string[];
    } catch {
      return [];
    }
  });

  // URL 中的关键词变化时同步输入框（渲染期同步前值，避免 effect 级联渲染）
  const [prevQuery, setPrevQuery] = useState(q);
  if (q !== prevQuery) {
    setPrevQuery(q);
    setInput(q);
  }

  // 记录搜索历史：与 URL 关键词同步（渲染期同步前值 + 幂等写入 localStorage）
  const [prevHistoryQuery, setPrevHistoryQuery] = useState(q);
  if (q !== prevHistoryQuery) {
    setPrevHistoryQuery(q);
    if (q.trim()) {
      setHistory((prev) => {
        const next = [q, ...prev.filter((item) => item !== q)].slice(0, 8);
        localStorage.setItem('vs-search-history', JSON.stringify(next));
        return next;
      });
    }
  }

  const query = useMemo<SearchQuery>(
    () => ({
      q: term,
      page,
      pageSize: 24,
      categoryId,
      duration,
      dateRange: dateRange === 'all' ? undefined : dateRange,
      sort,
      type: kind,
    }),
    [categoryId, dateRange, duration, kind, page, term, sort],
  );

  /*
   * 按「结果类型」选择不同的数据源。
   * 此前无论选哪个标签都只调视频搜索接口——服务端根本没有创作者搜索能力，
   * 前端传来的 type=user 被丢弃，所以永远搜不到人。
   */
  const videoQuery = useVideoSearch(query, kind === 'video');
  const userQuery = useUserSearch({ q: term, page, pageSize: 24 }, kind === 'user');
  const active = kind === 'user' ? userQuery : videoQuery;
  const { isLoading, isFetching, isError, refetch } = active;
  /** 视频结果里带 suggestions/costMs；创作者结果没有，因此按视频查询类型标注 */
  const data = active.data as
    | (import('@/api/videos').SearchResult & { items: (VideoSummary & Partial<UserBrief>)[] })
    | undefined;
  const items = data?.items ?? [];
  const users = (userQuery.data?.items ?? []) as (UserBrief & { videoCount?: number })[];
  const hasQuery = q.trim().length > 0;

  const setParam = (key: string, value?: string | number) => {
    const next = new URLSearchParams(params);
    if (value === undefined || value === '' || value === 'all') next.delete(key);
    else next.set(key, String(value));
    if (key !== 'page') next.delete('page');
    setParams(next);
  };

  const submit = () => {
    if (!input.trim()) {
      toast({ title: '请输入搜索关键词', tone: 'warning' });
      return;
    }
    setParam('q', input.trim());
  };

  const { data: categories } = useCategories();

  return (
    <PageContainer className="py-5">
      {/* 搜索框 */}
      <div className="mx-auto max-w-3xl">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          role="search"
          className="flex items-center gap-2"
        >
          <SearchInput
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onClear={() => setInput('')}
            placeholder="搜索视频、创作者、动态，也可用 @用户名 找创作者"
            aria-label="搜索关键词"
            className="h-11 flex-1"
            autoFocus
          />
          <Button type="submit" variant="primary" size="md" className="h-11 shrink-0 px-5">
            搜索
          </Button>
        </form>

        {!hasQuery && (
          <div className="mt-6 flex flex-col gap-5">
            {history.length > 0 && (
              <section>
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-medium text-fg-muted">搜索历史</h2>
                  <button
                    type="button"
                    onClick={() => {
                      setHistory([]);
                      localStorage.removeItem('vs-search-history');
                    }}
                    className="text-[11px] text-fg-subtle hover:text-fg"
                  >
                    清空
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {history.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setParam('q', item)}
                      className="inline-flex h-7 items-center gap-1 rounded-pill border border-line bg-surface px-3 text-xs text-fg-muted transition-colors hover:border-fg-subtle hover:text-fg"
                    >
                      {item}
                      <X
                        className="size-3"
                        onClick={(event) => {
                          event.stopPropagation();
                          setHistory((prev) => {
                            const next = prev.filter((h) => h !== item);
                            localStorage.setItem('vs-search-history', JSON.stringify(next));
                            return next;
                          });
                        }}
                      />
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h2 className="text-xs font-medium text-fg-muted">热门搜索</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {HOT_KEYWORDS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setParam('q', item)}
                    className="inline-flex h-7 items-center rounded-pill bg-surface-2 px-3 text-xs text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>

      {hasQuery && (
        <>
          {/* 结果类型 */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <Tabs
              items={[
                { key: 'video', label: '视频' },
                { key: 'user', label: '创作者' },
                { key: 'feed', label: '动态' },
              ]}
              value={kind}
              onChange={(key) => setParam('type', key)}
            />
            <span className="text-xs text-fg-subtle">
              {isFetching ? '正在搜索…' : `找到 ${formatCount(data?.total ?? 0)} 个结果`}
              {data?.costMs !== undefined && ` · 耗时 ${data.costMs}ms`}
            </span>
          </div>

          {/* 筛选区 */}
          <div className="mt-3 flex flex-col gap-3 rounded-card border border-line bg-surface p-3.5">
            <FilterRow
              icon={<SlidersHorizontal className="size-3.5" />}
              label="排序"
              options={SORTS.map((item) => ({ key: item.key, label: item.label }))}
              value={sort}
              onChange={(key) => setParam('sort', key)}
            />
            <FilterRow
              icon={<Filter className="size-3.5" />}
              label="分区"
              options={[{ key: 'all', label: '全部分区' }, ...(categories ?? []).map((c) => ({ key: String(c.id), label: c.name }))]}
              value={categoryId ? String(categoryId) : 'all'}
              onChange={(key) => setParam('category', key)}
              scrollable
            />
            {/*
              分区/时长/时间只对作品有意义。选「创作者」时它们不参与查询，
              继续展示会让用户以为筛选生效了，因此隐藏。
            */}
            {kind !== 'user' && (
              <>
                <FilterRow
                  label="时长"
                  options={DURATIONS.map((item) => ({ key: item.key, label: item.label }))}
                  value={duration ?? 'all'}
                  onChange={(key) => setParam('duration', key)}
                />
                <FilterRow
                  label="时间"
                  options={DATE_RANGES.map((item) => ({ key: item.key, label: item.label }))}
                  value={dateRange}
                  onChange={(key) => setParam('dateRange', key)}
                />
              </>
            )}
          </div>

          {/* 结果列表 */}
          <div className="mt-5">
            {isLoading ? (
              <div className="grid grid-cols-1 gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }, (_, i) => (
                  <VideoCardSkeleton key={i} />
                ))}
              </div>
            ) : isError ? (
              <ErrorState onRetry={() => void refetch()} />
            ) : items.length === 0 ? (
              <EmptyState
                title={`没有找到与「${q}」相关的内容`}
                description="换一个关键词试试，或减少筛选条件。也可以看看下面这些推荐。"
                action={
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {data?.suggestions?.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => setParam('q', suggestion)}
                        className="rounded-pill border border-line px-3 py-1 text-xs text-fg-muted hover:border-fg-subtle hover:text-fg"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                }
              />
            ) : kind === 'video' ? (
              <div className="grid grid-cols-1 gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {items.map((video) => (
                  <VideoCard key={video.id} video={video} />
                ))}
              </div>
            ) : kind === 'user' ? (
              <ul className="flex flex-col gap-2">
                {users.map((user) => (
                  <li
                    key={user.id}
                    className="cursor-pointer rounded-card border border-line bg-surface p-3 transition-colors hover:border-fg-subtle"
                    onClick={() => navigate(`/user/${user.id}`)}
                  >
                    <AvatarWithMeta
                      src={user.avatar}
                      name={user.nickname}
                      certified={user.certified}
                      meta={
                        <span className="flex flex-wrap items-center gap-2">
                          <span>@{user.username}</span>
                          <span aria-hidden>·</span>
                          <span>{formatCount(user.followerCount ?? 0)} 粉丝</span>
                          <span aria-hidden>·</span>
                          <span>{formatCount(user.videoCount ?? 0)} 作品</span>
                        </span>
                      }
                    />
                    {user.bio && (
                      <p className="mt-2 line-clamp-2 text-[13px] text-fg-muted sm:pl-[52px]">{user.bio}</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="flex flex-col gap-2">
                {items.map((video) => (
                  <li key={video.id} className="rounded-card border border-line bg-surface p-3">
                    <AvatarWithMeta
                      src={video.author.avatar}
                      name={video.author.nickname}
                      certified={video.author.certified}
                      meta={
                        <span className="flex items-center gap-2">
                          <span>{formatCount(video.author.followerCount ?? 0)} 粉丝</span>
                          <span aria-hidden>·</span>
                          <span>{formatRelative(video.publishedAt)} 更新</span>
                        </span>
                      }
                      onClick={() => navigate(`/user/${video.author.id}`)}
                    />
                    <p className="mt-2 line-clamp-2 pl-0 text-[13px] text-fg-muted sm:pl-[52px]">
                      代表作品：
                      <Link to={`/video/${video.id}`} className="text-fg hover:text-accent">
                        {video.title}
                      </Link>
                    </p>
                  </li>
                ))}
              </ul>
            )}

            {kind === 'feed' && items.length > 0 && (
              <p className="mt-4 text-center text-xs text-fg-subtle">
                动态搜索按内容相关性排序，共 {formatCount(data?.total ?? 0)} 条结果。
              </p>
            )}

            {(data?.total ?? 0) > (data?.pageSize ?? 24) && (
              <Pagination
                page={page}
                total={data?.total ?? 0}
                pageSize={data?.pageSize ?? 24}
                onChange={(next) => setParam('page', next)}
                className="mt-8"
              />
            )}
          </div>

          {/* 搜索建议 */}
          {data?.suggestions && data.suggestions.length > 0 && items.length > 0 && (
            <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <span className="text-xs text-fg-subtle">相关搜索</span>
              {data.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setParam('q', suggestion)}
                  className="inline-flex h-7 items-center gap-1 rounded-pill bg-surface-2 px-3 text-xs text-fg-muted hover:text-fg"
                >
                  <Search className="size-3" aria-hidden />
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </PageContainer>
  );
}

function FilterRow({
  icon,
  label,
  options,
  value,
  onChange,
  scrollable,
}: {
  icon?: React.ReactNode;
  label: string;
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  scrollable?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-1 inline-flex w-14 shrink-0 items-center gap-1 text-[11px] text-fg-subtle">
        {icon}
        {label}
      </span>
      <div className={cn('flex flex-wrap items-center gap-1.5', scrollable && 'hide-scrollbar overflow-x-auto')}>
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={value === option.key}
            onClick={() => onChange(option.key)}
            className={cn(
              'h-7 shrink-0 rounded-[6px] px-2.5 text-xs transition-colors',
              value === option.key ? 'bg-fg font-medium text-canvas' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
