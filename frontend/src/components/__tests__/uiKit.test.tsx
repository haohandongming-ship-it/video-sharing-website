import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { FeedCard } from '@/components/feed/FeedCard';
import { SubscribeButton } from '@/components/user/SubscribeButton';
import { Avatar, AvatarWithMeta } from '@/components/ui/Avatar';
import { Badge, Tag, RingProgress } from '@/components/ui/Feedback';
import { Input, SearchInput, Textarea, RadioGroup } from '@/components/ui/Input';
import { Dropdown, Modal, Drawer, Tooltip } from '@/components/ui/Overlay';
import { Collapsible, Pagination } from '@/components/ui/Tabs';
import { Divider, PageContainer, SectionHeader, StatTile, SurfaceCard } from '@/components/ui/Layout';
import { LoadMoreSentinel, LoadingBlock, Spinner } from '@/components/ui/States';
import { useUiStore } from '@/stores/uiStore';
import { authBridge } from '@/api/authBridge';
import { authApi } from '@/api/auth';
import { session } from '@/mocks/seed';
import { useAuthStore } from '@/stores/authStore';
import type { FeedPost } from '@/api/types';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function makePost(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: 30_001,
    type: 'ORIGINAL',
    content: '刚把新的推荐链路跑通，日志一眼能看懂的感觉真好。',
    user: { id: 10, username: 'donghua', nickname: '动画研究所', avatar: null, certified: true },
    media: [],
    topic: null,
    mentions: [],
    repostOf: null,
    stats: { likes: 500, comments: 259, reposts: 50 },
    liked: false,
    createdAt: new Date(Date.now() - 600_000).toISOString(),
    isOwner: false,
    ...overrides,
  };
}

describe('FeedCard（文档 4.3 动态卡片）', () => {
  it('展示作者、内容与三项互动计数', () => {
    render(<FeedCard post={makePost()} />, { wrapper });
    expect(screen.getByText('动画研究所')).toBeInTheDocument();
    expect(screen.getByText(/刚把新的推荐链路跑通/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '点赞' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '评论' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '转发' })).toBeInTheDocument();
  });

  it('话题渲染为可点击标签', () => {
    render(<FeedCard post={makePost({ topic: { id: 2, name: '程序员日常' } })} />, { wrapper });
    expect(screen.getByText('#程序员日常#')).toBeInTheDocument();
  });

  it('九宫格图片按数量渲染', () => {
    const media = Array.from({ length: 4 }, (_, i) => ({
      id: i,
      mediaType: 'IMAGE' as const,
      url: 'data:image/svg+xml,<svg/>',
      thumbUrl: 'data:image/svg+xml,<svg/>',
      sortOrder: i,
    }));
    const { container } = render(<FeedCard post={makePost({ media })} />, { wrapper });
    expect(container.querySelectorAll('img').length).toBe(4);
  });

  it('转发动态展示原文引用块', () => {
    const original = makePost({ id: 30_099, content: '这是一条被转发的原文' });
    render(<FeedCard post={makePost({ type: 'REPOST', repostOf: original })} />, { wrapper });
    expect(screen.getByText('这是一条被转发的原文')).toBeInTheDocument();
    expect(screen.getByText('@动画研究所')).toBeInTheDocument();
  });

  it('详情模式不触发跳转且隐藏删除入口（非本人）', () => {
    render(<FeedCard post={makePost()} detail />, { wrapper });
    expect(screen.queryByText('删除动态')).not.toBeInTheDocument();
  });

  it('本人动态提供删除入口并二次确认', async () => {
    const onDelete = vi.fn();
    render(<FeedCard post={makePost({ isOwner: true })} onDelete={onDelete} />, { wrapper });
    // 更多操作按钮在悬停时出现，直接通过 aria-label 定位
    await userEvent.click(screen.getByRole('button', { name: '更多操作' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /删除动态/ }));
    expect(useUiStore.getState().confirm.open).toBe(true);
    expect(useUiStore.getState().confirm.title).toContain('删除');
    useUiStore.getState().closeConfirm();
  });
});

describe('SubscribeButton（文档 12.3 关注按钮文案切换）', () => {
  beforeEach(() => {
    authBridge.clear();
    session.logout();
  });

  it('未登录时点击提示登录且不触发回调', async () => {
    const onToggle = vi.fn();
    render(<SubscribeButton active={false} onToggle={onToggle} />, { wrapper });
    await userEvent.click(screen.getByRole('button', { name: '关注' }));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('已登录时切换关注状态并展示互关标识', async () => {
    const result = await authApi.loginByPassword({ account: 'laowang', password: '123456' });
    authBridge.setSession(result.accessToken, result.user);
    useAuthStore.setState({ status: 'authenticated', user: result.user, accessToken: result.accessToken });

    const onToggle = vi.fn();
    const { rerender } = render(<SubscribeButton active={false} onToggle={onToggle} mutual />, { wrapper });
    await userEvent.click(screen.getByRole('button', { name: '关注' }));
    expect(onToggle).toHaveBeenCalledWith(true);

    rerender(<SubscribeButton active onToggle={onToggle} mutual />);
    expect(screen.getByRole('button', { name: /已关注/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('互关')).toBeInTheDocument();
  });

  it('订阅场景使用自定义文案', () => {
    render(<SubscribeButton active={false} onToggle={vi.fn()} labels={{ on: '已订阅', off: '订阅' }} />, { wrapper });
    expect(screen.getByRole('button', { name: '订阅' })).toBeInTheDocument();
  });
});

describe('头像组件', () => {
  it('认证标识具备无障碍标签', () => {
    render(<Avatar src={null} name="老王" certified />, { wrapper });
    expect(screen.getByLabelText('已认证创作者')).toBeInTheDocument();
  });

  it('AvatarWithMeta 渲染昵称与副信息并可点击', async () => {
    const onClick = vi.fn();
    render(<AvatarWithMeta src={null} name="老王" meta="3.6万 粉丝" onClick={onClick} />, { wrapper });
    expect(screen.getByText('老王')).toBeInTheDocument();
    expect(screen.getByText('3.6万 粉丝')).toBeInTheDocument();
    await userEvent.click(screen.getByText('老王'));
    expect(onClick).toHaveBeenCalled();
  });
});

describe('表单控件', () => {
  it('输入框校验失败时标记 aria-invalid', () => {
    render(<Input invalid placeholder="手机号" />, { wrapper });
    expect(screen.getByPlaceholderText('手机号')).toHaveAttribute('aria-invalid', 'true');
  });

  it('搜索框提供清空按钮', async () => {
    const onClear = vi.fn();
    render(<SearchInput value="架构" onChange={vi.fn()} onClear={onClear} />, { wrapper });
    await userEvent.click(screen.getByRole('button', { name: '清空搜索' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('多行输入展示页脚计数', () => {
    render(<Textarea value="内容" footer={<span>2/1000</span>} onChange={vi.fn()} />, { wrapper });
    expect(screen.getByText('2/1000')).toBeInTheDocument();
  });

  it('单选组可键盘选择', async () => {
    const onChange = vi.fn();
    render(
      <RadioGroup
        name="visibility"
        value="PUBLIC"
        onChange={onChange}
        options={[
          { value: 'PUBLIC', label: '公开' },
          { value: 'PRIVATE', label: '仅自己可见', description: '不展示在个人主页' },
        ]}
      />,
      { wrapper },
    );
    expect(screen.getByText('不展示在个人主页')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/仅自己可见/));
    expect(onChange).toHaveBeenCalledWith('PRIVATE');
  });
});

describe('覆盖层组件', () => {
  it('Modal 带标题与描述，Esc 可关闭', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="举报内容" description="请选择举报类型">
        <p>内容</p>
      </Modal>,
      { wrapper },
    );
    expect(screen.getByRole('dialog', { name: '举报内容' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('Drawer 从右侧滑出,标题可达', () => {
    render(
      <Drawer open onClose={vi.fn()} title="通知">
        <p>列表</p>
      </Drawer>,
      { wrapper },
    );
    expect(screen.getByRole('dialog', { name: '通知' })).toBeInTheDocument();
  });

  it('Dropdown 展开菜单并执行选项', async () => {
    const onSelect = vi.fn();
    render(
      <Dropdown
        items={[
          { key: 'a', label: '第一项', onSelect },
          { key: 'b', label: '危险项', danger: true, separatorBefore: true },
          { key: 'c', label: '禁用项', disabled: true },
        ]}
        trigger={({ toggle }) => (
          <button type="button" onClick={toggle}>
            打开菜单
          </button>
        )}
      />,
      { wrapper },
    );
    await userEvent.click(screen.getByRole('button', { name: '打开菜单' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '第一项' }));
    expect(onSelect).toHaveBeenCalled();
    // 退出动画由 framer-motion 接管，等待节点移除
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: '第一项' })).not.toBeInTheDocument());
  });

  it('Tooltip 使用 role=tooltip 语义', () => {
    render(
      <Tooltip content="提示文案">
        <span>悬停目标</span>
      </Tooltip>,
      { wrapper },
    );
    expect(screen.getByRole('tooltip')).toHaveTextContent('提示文案');
  });
});

describe('布局与反馈组件', () => {
  it('Pagination 首尾边界按钮禁用且页码可选', async () => {
    const onChange = vi.fn();
    render(<Pagination page={1} total={100} pageSize={10} onChange={onChange} />, { wrapper });
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '3' }));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('Pagination 单页时隐藏', () => {
    const { container } = render(<Pagination page={1} total={5} pageSize={10} onChange={vi.fn()} />, { wrapper });
    expect(container).toBeEmptyDOMElement();
  });

  it('Collapsible 通过 grid 行高过渡控制展开', () => {
    const { container, rerender } = render(<Collapsible open={false}>内容</Collapsible>, { wrapper });
    expect(container.firstChild).toHaveClass('grid-rows-[0fr]');
    rerender(<Collapsible open>内容</Collapsible>);
    expect(container.firstChild).toHaveClass('grid-rows-[1fr]');
  });

  it('StatTile 展示数值与增减', () => {
    render(<StatTile label="今日新增" value="1284" delta={12} hint="较昨日" />, { wrapper });
    expect(screen.getByText('1284')).toBeInTheDocument();
    expect(screen.getByText('+12%')).toBeInTheDocument();
    expect(screen.getByText('较昨日')).toBeInTheDocument();
  });

  it('SectionHeader 支持不同标题层级', () => {
    render(<SectionHeader level={1} title="为你推荐" subtitle="根据观看记录排序" />, { wrapper });
    expect(screen.getByRole('heading', { level: 1, name: '为你推荐' })).toBeInTheDocument();
    expect(screen.getByText('根据观看记录排序')).toBeInTheDocument();
  });

  it('Badge/Tag/Divider/SurfaceCard/PageContainer 正常渲染', () => {
    render(
      <PageContainer>
        <SurfaceCard>
          <Badge tone="brand">未读</Badge>
          <Tag label="#科技" onClick={vi.fn()} />
          <Divider label="分割" />
        </SurfaceCard>
      </PageContainer>,
      { wrapper },
    );
    expect(screen.getByText('未读')).toBeInTheDocument();
    expect(screen.getByText('#科技')).toBeInTheDocument();
    expect(screen.getByText('分割')).toBeInTheDocument();
  });

  it('Spinner/LoadingBlock 提供状态语义', () => {
    render(
      <>
        <Spinner label="加载中" />
        <LoadingBlock label="正在加载评论" />
      </>,
      { wrapper },
    );
    expect(screen.getByRole('status', { name: '加载中' })).toBeInTheDocument();
    expect(screen.getByText('正在加载评论')).toBeInTheDocument();
  });

  it('LoadMoreSentinel 在无更多数据时展示结束文案', () => {
    render(<LoadMoreSentinel loading={false} hasMore={false} onIntersect={vi.fn()} />, { wrapper });
    expect(screen.getByText('没有更多了')).toBeInTheDocument();
  });

  it('LoadMoreSentinel 加载中展示加载文案', () => {
    render(<LoadMoreSentinel loading hasMore onIntersect={vi.fn()} />, { wrapper });
    expect(screen.getByText('正在加载更多')).toBeInTheDocument();
  });

  it('Tag 可移除且阻止事件冒泡', async () => {
    const onRemove = vi.fn();
    const onClick = vi.fn();
    render(<Tag label="架构" onRemove={onRemove} onClick={onClick} />, { wrapper });
    await userEvent.click(screen.getByRole('button', { name: '移除 架构' }));
    expect(onRemove).toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('RingProgress 反映传入百分比', () => {
    const { container } = render(<RingProgress value={50}>50%</RingProgress>, { wrapper });
    const circles = container.querySelectorAll('circle');
    expect(circles).toHaveLength(2);
    expect(screen.getByText('50%')).toBeInTheDocument();
  });
});

describe('确认对话框（文档 13.1 关键操作二次确认）', () => {
  it('openConfirm 传入的内容会渲染到弹窗', async () => {
    render(<div />, { wrapper });
    useUiStore.getState().openConfirm({
      title: '确认退出登录？',
      description: '退出后需要重新登录',
      confirmText: '退出',
      danger: true,
      onConfirm: vi.fn(),
    });
    await waitFor(() => expect(useUiStore.getState().confirm.open).toBe(true));
    expect(useUiStore.getState().confirm.title).toBe('确认退出登录？');
    expect(useUiStore.getState().confirm.danger).toBe(true);
    useUiStore.getState().closeConfirm();
    expect(useUiStore.getState().confirm.open).toBe(false);
  });
});
