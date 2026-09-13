import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { VideoCard } from '@/components/video/VideoCard';
import { EmptyState, ErrorState, VideoCardSkeleton } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Input';
import { Avatar } from '@/components/ui/Avatar';
import { ProgressBar, RingProgress } from '@/components/ui/Feedback';
import { Tabs } from '@/components/ui/Tabs';
import { VideoPlayer } from '@/components/video/VideoPlayer';
import type { VideoSummary } from '@/api/types';

function makeVideo(overrides: Partial<VideoSummary> = {}): VideoSummary {
  return {
    id: 12_345,
    videoType: 'LONG',
    title: '从零构建视频分享平台 · 架构篇',
    coverUrl: 'data:image/svg+xml,<svg/>',
    duration: 1860,
    category: { id: 3, name: '科技', slug: 'tech', sortOrder: 3 },
    author: { id: 501, username: 'laowang', nickname: '架构师老王', avatar: null, certified: true },
    stats: { views: 125_000, likes: 8_900, dislikes: 12, comments: 342, favorites: 2_100 },
    publishedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    status: 'PUBLISHED',
    visibility: 'PUBLIC',
    ...overrides,
  };
}

const renderWithRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('VideoCard', () => {
  it('展示标题、时长、作者与播放量，并链接到播放页', () => {
    renderWithRouter(<VideoCard video={makeVideo()} />);
    expect(screen.getByText('从零构建视频分享平台 · 架构篇')).toBeInTheDocument();
    expect(screen.getByText('31:00')).toBeInTheDocument();
    expect(screen.getByText('架构师老王')).toBeInTheDocument();
    expect(screen.getByText('12.5万')).toBeInTheDocument();

    const links = screen.getAllByRole('link');
    expect(links.some((link) => link.getAttribute('href') === '/video/12345')).toBe(true);
  });

  it('短视频卡片跳转到沉浸页并带 videoId', () => {
    renderWithRouter(<VideoCard video={makeVideo({ videoType: 'SHORT', duration: 45 })} />);
    const links = screen.getAllByRole('link');
    expect(links.some((link) => link.getAttribute('href') === '/shorts?v=12345')).toBe(true);
  });

  it('审核中与私密状态有明确标识', () => {
    const { rerender } = renderWithRouter(<VideoCard video={makeVideo({ status: 'REVIEWING' })} />);
    expect(screen.getByText('审核中')).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <VideoCard video={makeVideo({ visibility: 'PRIVATE' })} />
      </MemoryRouter>,
    );
    expect(screen.getByText('仅自己')).toBeInTheDocument();
  });

  it('历史场景展示观看进度文案', () => {
    renderWithRouter(<VideoCard video={makeVideo({ progress: 600 })} layout="row" />);
    expect(screen.getByText(/已看 10:00 \/ 31:00/)).toBeInTheDocument();
  });

  it('推荐理由仅在开启 showReason 时渲染', () => {
    const video = makeVideo({ recommendReason: '你最近常看「科技」相关内容' });
    const { rerender } = renderWithRouter(<VideoCard video={video} />);
    expect(screen.queryByText('你最近常看「科技」相关内容')).not.toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <VideoCard video={video} showReason />
      </MemoryRouter>,
    );
    expect(screen.getByText('你最近常看「科技」相关内容')).toBeInTheDocument();
  });
});

describe('状态组件（文档 12.2 三态要求）', () => {
  it('骨架屏与真实卡片保持相同布局尺寸', () => {
    const { container } = render(<VideoCardSkeleton />);
    expect(container.querySelector('.aspect-video')).toBeTruthy();
    expect(container.querySelector('.skeleton-sheen')).toBeTruthy();
  });

  it('空状态提供插画、文案与 CTA', () => {
    render(<EmptyState title="还没有视频" description="去上传第一个吧" action={<Button>上传视频</Button>} />);
    expect(screen.getByText('还没有视频')).toBeInTheDocument();
    expect(screen.getByText('去上传第一个吧')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上传视频' })).toBeInTheDocument();
  });

  it('错误态可重试，并在离线时切换文案', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ErrorState onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: /重新加载/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<ErrorState offline />);
    expect(screen.getByText('网络连接不可用')).toBeInTheDocument();
  });
});

describe('基础交互组件', () => {
  it('按钮加载态禁用点击并展示处理中文案', async () => {
    const onClick = vi.fn();
    render(
      <Button loading loadingText="处理中..." onClick={onClick}>
        提交
      </Button>,
    );
    const button = screen.getByRole('button', { name: /处理中/ });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('开关可键盘操作并同步 aria-checked', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="青少年模式" />);
    const toggle = screen.getByRole('switch', { name: '青少年模式' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('头像加载失败时回退为首字母', async () => {
    render(<Avatar src="http://invalid.local/404.png" name="老王" />);
    const img = screen.getByAltText('老王');
    // 图片加载失败 → onError 切换为文字头像
    img.dispatchEvent(new Event('error'));
    expect(await screen.findByText('老')).toBeInTheDocument();
    expect(screen.queryByAltText('老王')).not.toBeInTheDocument();
  });

  it('进度条暴露无障碍语义', () => {
    render(<ProgressBar value={42} max={100} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('环形进度展示百分比内容', () => {
    render(<RingProgress value={68}>68%</RingProgress>);
    expect(screen.getByText('68%')).toBeInTheDocument();
  });

  it('Tabs 切换触发回调且标记选中态', async () => {
    const onChange = vi.fn();
    render(
      <Tabs
        items={[
          { key: 'hot', label: '最热' },
          { key: 'new', label: '最新' },
        ]}
        value="hot"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('tab', { name: '最热' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('tab', { name: '最新' }));
    expect(onChange).toHaveBeenCalledWith('new');
  });
});

describe('VideoPlayer 控制层', () => {
  it('渲染播放器区域并暴露无障碍标签与播放按钮', () => {
    render(
      <VideoPlayer src="/demo/hls/master.m3u8" title="演示视频" startTime={0} showShortcuts={false} />,
    );
    expect(screen.getByRole('region', { name: /播放器：演示视频/ })).toBeInTheDocument();
    // 中央播放遮罩与控制条播放键各一个，均为可访问的播放入口
    expect(screen.getAllByRole('button', { name: /播放/ }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('slider', { name: '播放进度' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /全屏/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /静音/ })).toBeInTheDocument();
  });

  it('音量快捷键改变全局偏好（M 静音）', async () => {
    const { useUiStore } = await import('@/stores/uiStore');
    const before = useUiStore.getState().muted;
    render(<VideoPlayer src="/demo/hls/master.m3u8" title="快捷键测试" showShortcuts={false} />);
    await userEvent.keyboard('m');
    expect(useUiStore.getState().muted).toBe(!before);
  });
});
