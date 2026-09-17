import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import type { DanmakuItem } from '@/api/types';

export interface DanmakuLayerProps {
  items: DanmakuItem[];
  /** 当前播放位置（秒） */
  currentTime: number;
  visible: boolean;
  className?: string;
}

/** 一条弹幕从右侧滚到左侧的时长（秒） */
const SCROLL_DURATION = 8;
/** 投放上限：每个时间桶最多几条，避免密集时段糊屏 */
const PER_BUCKET = 3;
const BUCKET_SECONDS = 0.5;
/** 滚动弹幕的纵向轨道数，按序号轮转分配以减少重叠 */
const LANES = 6;

/**
 * 弹幕渲染层。
 *
 * <p>可见弹幕**由 currentTime 直接派生**，不放进 state：
 * 用「最近 SCROLL_DURATION 秒内发布、且尚未滚完」作为窗口筛选。这样：
 * <ul>
 *   <li>不需要在 effect 里 setState（会触发级联渲染）；</li>
 *   <li>暂停时 currentTime 不再变化，窗口固定，弹幕停在原位而不是继续跑；</li>
 *   <li>React 按 key 复用同一 DOM 节点，CSS 动画不会被后续渲染打断重放。</li>
 * </ul>
 *
 * <p>横移距离依赖容器宽度（弹幕从右外侧进、左外侧出），宽度由 ResizeObserver 量取后
 * 通过 CSS 变量传给关键帧，避免在关键帧里使用 cqw 等较新单位。
 */
export function DanmakuLayer({ items, currentTime, visible, className }: DanmakuLayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      setWidth((previous) => (Math.abs(previous - next) < 1 ? previous : next));
    });
    observer.observe(node);
    setWidth(node.clientWidth);
    return () => observer.disconnect();
  }, []);

  if (!visible || items.length === 0) return null;

  const from = currentTime - SCROLL_DURATION;
  const to = currentTime;
  const perBucket = new Map<number, number>();
  const visibleItems: { item: DanmakuItem; lane: number }[] = [];
  let lane = 0;
  for (const item of items) {
    const at = item.timeMs / 1000;
    if (at > to) break;
    if (at < from) continue;
    // 同一时间桶限量投放，避免整屏被同一秒的弹幕占满
    const bucket = Math.floor(at / BUCKET_SECONDS);
    const used = perBucket.get(bucket) ?? 0;
    if (used >= PER_BUCKET) continue;
    perBucket.set(bucket, used + 1);
    visibleItems.push({ item, lane: lane % LANES });
    lane += 1;
  }
  if (visibleItems.length === 0) return null;

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 z-10 overflow-hidden', className)}
      style={{ '--dm-distance': `${width}px` } as React.CSSProperties}
    >
      {visibleItems.map(({ item, lane: row }) =>
        item.position === 'SCROLL' ? (
          <span
            key={item.id}
            className="absolute whitespace-nowrap text-[15px] font-medium drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]"
            style={{
              top: `${8 + row * 9}%`,
              left: '100%',
              color: item.color,
              animation: `var(--animate-danmaku-scroll) ${SCROLL_DURATION}s`,
            }}
          >
            {item.content}
          </span>
        ) : (
          <span
            key={item.id}
            className={cn(
              'absolute left-1/2 max-w-[90%] -translate-x-1/2 truncate text-[15px] font-medium drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]',
              item.position === 'TOP' ? 'top-[8%]' : 'bottom-[18%]',
            )}
            style={{ color: item.color }}
          >
            {item.content}
          </span>
        ),
      )}
    </div>
  );
}
