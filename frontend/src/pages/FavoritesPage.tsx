/**
 * 收藏页（文档 3.3 / 3.2：收藏夹、稍后观看、播放列表）
 * 桌面端左侧收藏夹列表 + 右侧网格；移动端用 pill 标签横向切换。
 * 批量移出 / 加入播放列表为本地状态，不落库。
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Compass, HeartOff, ListPlus } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  Button,
  Dropdown,
  EmptyState,
  ErrorState,
  PageContainer,
  Pagination,
  SectionHeader,
  Skeleton,
  Tabs,
  VideoCard,
  VideoGridSkeleton,
  type TabItem,
} from '@/components/ui';
import { useFavorites, usePlaylists } from '@/hooks/useApi';
import { formatCount } from '@/lib/format';
import { useUiStore } from '@/stores/uiStore';

export default function FavoritesPage() {
  const [page, setPage] = useState(1);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  /** 本地移出的视频：接口不落库，仅隐藏当前会话的展示 */
  const [removed, setRemoved] = useState<ReadonlySet<number>>(new Set());

  const query = useFavorites({ page, folderId: folderId ?? undefined });
  const playlists = usePlaylists();

  const data = query.data;
  const folders = data?.folders ?? [];
  const total = data?.total ?? 0;
  const videos = (data?.items ?? []).filter((video) => !removed.has(video.id));
  const activeFolder = folders.find((folder) => folder.id === folderId) ?? null;

  const selectFolder = (next: number | null) => {
    setFolderId(next);
    setPage(1);
    setSelected(new Set());
  };

  const toggleSelect = (videoId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return next;
    });
  };

  const handleRemove = () => {
    const count = selected.size;
    if (count === 0) return;
    setRemoved((prev) => new Set([...prev, ...selected]));
    setSelected(new Set());
    useUiStore.getState().toast({
      title: `已移出 ${count} 个视频`,
      description: '本次移除只作用于当前会话，刷新后会恢复原始列表。',
      tone: 'success',
    });
  };

  const handleAddToPlaylist = (playlistName: string) => {
    const count = selected.size;
    if (count === 0) return;
    setSelected(new Set());
    useUiStore.getState().toast({
      title: `已把 ${count} 个视频加入「${playlistName}」`,
      tone: 'success',
    });
  };

  const playlistOptions = playlists.data?.length
    ? playlists.data.map((playlist) => ({
        key: String(playlist.id),
        label: `${playlist.name}（${playlist.count}）`,
        onSelect: () => handleAddToPlaylist(playlist.name),
      }))
    : [{ key: 'empty', label: '还没有播放列表', disabled: true }];

  const folderTabItems: TabItem<string>[] = [
    { key: 'all', label: '全部', count: total },
    ...folders.map((folder) => ({ key: String(folder.id), label: folder.name, count: folder.count })),
  ];

  const listHeader = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 className="truncate text-base font-semibold text-fg">{activeFolder?.name ?? '全部收藏'}</h2>
        <p className="mt-0.5 text-xs text-fg-muted">
          共 {formatCount(Math.max(0, total - removed.size))} 个视频
          {activeFolder?.isDefault ? ' · 新收藏默认放进这里' : ''}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {selected.size > 0 && (
          <>
            <span className="text-xs text-fg-muted">已选 {selected.size} 个</span>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              取消选择
            </Button>
          </>
        )}
        <Dropdown
          align="end"
          items={playlistOptions}
          trigger={({ toggle }) => (
            <Button
              size="sm"
              variant="outline"
              disabled={selected.size === 0}
              icon={<ListPlus className="size-3.5" aria-hidden />}
              onClick={() => {
                if (selected.size > 0) toggle();
              }}
            >
              加入播放列表
            </Button>
          )}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={selected.size === 0}
          icon={<HeartOff className="size-3.5" aria-hidden />}
          onClick={handleRemove}
        >
          移出收藏
        </Button>
      </div>
    </div>
  );

  return (
    <PageContainer className="pt-6 pb-12">
      <SectionHeader
        level={1}
        title="我的收藏"
        subtitle="按收藏夹整理内容，也可以批量移出或加进播放列表。"
      />

      {/* 播放列表 */}
      <section className="mt-6">
        <SectionHeader title="播放列表" subtitle="把收藏的视频编成系列，按顺序连着看。" />
        <div className="mt-3">
          {playlists.isPending && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="flex flex-col gap-2">
                  <Skeleton className="aspect-video w-full" rounded="lg" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          )}

          {playlists.isError && (
            <p className="text-xs text-fg-muted">
              播放列表加载失败。
              <Button variant="link" size="sm" className="ml-1" onClick={() => void playlists.refetch()}>
                重新加载
              </Button>
            </p>
          )}

          {playlists.data && playlists.data.length === 0 && (
            <p className="text-xs text-fg-muted">还没有创建播放列表。收藏视频后可以在这里建一个。</p>
          )}

          {playlists.data && playlists.data.length > 0 && (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {playlists.data.map((playlist) => (
                <li key={playlist.id}>
                  <button
                    type="button"
                    aria-label={`播放列表 ${playlist.name}，共 ${playlist.count} 个视频`}
                    onClick={() =>
                      useUiStore.getState().toast({
                        title: `「${playlist.name}」连续播放`,
                        description: '播放列表的连播能力还在开发中。',
                        tone: 'info',
                      })
                    }
                    className="group flex w-full flex-col gap-2 rounded-card border border-line bg-surface p-2.5 text-left transition-shadow duration-200 hover:shadow-raised"
                  >
                    <span className="relative block aspect-video w-full overflow-hidden rounded-[8px] bg-surface-2">
                      <img
                        src={playlist.cover}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="size-full object-cover transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.03]"
                      />
                      <span className="absolute right-1.5 bottom-1.5 rounded-[4px] bg-black/78 px-1.5 py-0.5 text-[11px] tabular-nums text-white">
                        {formatCount(playlist.count)} 个
                      </span>
                    </span>
                    <span className="truncate text-[13px] font-medium text-fg">{playlist.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 收藏列表 */}
      <div className="mt-8 flex flex-col gap-5 lg:flex-row lg:items-start">
        {/* 桌面端收藏夹侧栏 */}
        <aside className="hidden lg:block lg:w-56 lg:shrink-0">
          <h2 className="px-3 text-xs font-medium text-fg-subtle">收藏夹</h2>
          <nav aria-label="收藏夹" className="mt-2">
            <ul className="flex flex-col gap-0.5">
              <li>
                <FolderButton
                  label="全部收藏"
                  count={total}
                  active={folderId === null}
                  onClick={() => selectFolder(null)}
                />
              </li>
              {folders.map((folder) => (
                <li key={folder.id}>
                  <FolderButton
                    label={folder.name}
                    count={folder.count}
                    active={folderId === folder.id}
                    onClick={() => selectFolder(folder.id)}
                  />
                </li>
              ))}
            </ul>
          </nav>
          <p className="mt-4 px-3 text-[11px] leading-relaxed text-fg-subtle">
            收藏夹默认仅自己可见，可以在设置里调整公开范围。
          </p>
        </aside>

        <div className="min-w-0 flex-1">
          {/* 移动端收藏夹切换 */}
          <div className="lg:hidden">
            <Tabs
              items={folderTabItems}
              value={folderId === null ? 'all' : String(folderId)}
              onChange={(key) => selectFolder(key === 'all' ? null : Number(key))}
              variant="pill"
              size="sm"
              scrollable
            />
          </div>

          <div className="mt-5 lg:mt-0">{listHeader}</div>

          <div className="mt-5">
            {query.isPending && <VideoGridSkeleton count={6} />}

            {query.isError && (
              <ErrorState
                title="收藏加载失败"
                description="没能取到收藏列表，请检查网络后重试。"
                onRetry={() => void query.refetch()}
              />
            )}

            {query.data && videos.length === 0 && (
              <EmptyState
                icon={<Compass className="size-7" aria-hidden />}
                title="收藏夹还是空的"
                description={
                  activeFolder
                    ? `「${activeFolder.name}」里还没有视频，去首页挑几个放进来吧。`
                    : '还没有收藏任何视频，在播放页点「收藏」就会出现在这里。'
                }
                action={
                  <Link to="/">
                    <Button variant="primary">去首页看看</Button>
                  </Link>
                }
              />
            )}

            {data && videos.length > 0 && (
              <>
                {/* 栅格与 VideoCardGrid columns={3} 一致，额外包一层以便放置选择覆盖层 */}
                <ul className="grid grid-cols-1 gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
                  {videos.map((video) => {
                    const isSelected = selected.has(video.id);
                    return (
                      <li
                        key={video.id}
                        className={cn(
                          'group relative rounded-card',
                          isSelected && 'ring-2 ring-brand ring-offset-2 ring-offset-canvas',
                        )}
                      >
                        <VideoCard video={video} />
                        {/* 自定义选择覆盖层：移动端常驻，桌面端悬停/聚焦时出现 */}
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={isSelected}
                          aria-label={`选择《${video.title}》`}
                          onClick={() => toggleSelect(video.id)}
                          className={cn(
                            'absolute top-2 right-2 z-10 grid size-6 place-items-center rounded-[6px] border transition-opacity duration-150',
                            isSelected
                              ? 'border-brand bg-brand text-white'
                              : 'border-line bg-surface/92 text-fg-subtle',
                            !isSelected &&
                              'lg:pointer-events-none lg:opacity-0 lg:group-hover:pointer-events-auto lg:group-hover:opacity-100 lg:focus-visible:pointer-events-auto lg:focus-visible:opacity-100',
                          )}
                        >
                          <Check className="size-3.5" aria-hidden />
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <Pagination
                  page={data.page}
                  total={data.total}
                  pageSize={data.pageSize}
                  onChange={(next) => {
                    setPage(next);
                    setSelected(new Set());
                  }}
                  className="mt-10"
                />
              </>
            )}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}

/* ------------------------------------------------------------ 收藏夹条目 */

function FolderButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-btn px-3 py-2 text-left text-[13px] transition-colors duration-150',
        active ? 'bg-surface-2 font-medium text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
      )}
    >
      <span className="truncate">{label}</span>
      <span className="shrink-0 text-[11px] tabular-nums text-fg-subtle">{formatCount(count)}</span>
    </button>
  );
}
