import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem<T extends string = string> {
  key: T;
  label: string;
  icon?: ReactNode;
  count?: number;
  disabled?: boolean;
}

export interface TabsProps<T extends string = string> {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  variant?: 'underline' | 'pill' | 'segment';
  size?: 'sm' | 'md';
  className?: string;
  scrollable?: boolean;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  variant = 'underline',
  size = 'md',
  className,
  scrollable,
}: TabsProps<T>) {
  if (variant === 'segment') {
    return (
      <div
        role="tablist"
        className={cn('inline-flex items-center gap-1 rounded-pill bg-surface-2 p-1', className)}
      >
        {items.map((item) => (
          <button
            key={item.key}
            role="tab"
            type="button"
            aria-selected={value === item.key}
            disabled={item.disabled}
            onClick={() => onChange(item.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-pill font-medium transition-colors duration-200',
              size === 'sm' ? 'h-7 px-3 text-xs' : 'h-8 px-4 text-[13px]',
              value === item.key ? 'bg-surface text-fg shadow-card' : 'text-fg-muted hover:text-fg',
              item.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            {item.icon}
            {item.label}
            {item.count !== undefined && <span className="tabular-nums opacity-70">{item.count}</span>}
          </button>
        ))}
      </div>
    );
  }

  if (variant === 'pill') {
    return (
      <div
        role="tablist"
        className={cn('flex items-center gap-2', scrollable && 'hide-scrollbar overflow-x-auto', className)}
      >
        {items.map((item) => (
          <button
            key={item.key}
            role="tab"
            type="button"
            aria-selected={value === item.key}
            disabled={item.disabled}
            onClick={() => onChange(item.key)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-pill border font-medium transition-colors duration-200',
              size === 'sm' ? 'h-7 px-3 text-xs' : 'h-9 px-4 text-[13px]',
              value === item.key
                ? 'border-transparent bg-fg text-canvas'
                : 'border-line bg-surface text-fg-muted hover:border-fg-subtle hover:text-fg',
              item.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            {item.icon}
            {item.label}
            {item.count !== undefined && <span className="tabular-nums opacity-70">{item.count}</span>}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      role="tablist"
      className={cn(
        'flex items-center gap-1 border-b border-line',
        scrollable && 'hide-scrollbar overflow-x-auto',
        className,
      )}
    >
      {items.map((item) => {
        const active = value === item.key;
        return (
          <button
            key={item.key}
            role="tab"
            type="button"
            aria-selected={active}
            disabled={item.disabled}
            onClick={() => onChange(item.key)}
            className={cn(
              'relative inline-flex shrink-0 items-center gap-1.5 px-3 pb-2.5 font-medium transition-colors duration-200',
              size === 'sm' ? 'text-xs' : 'text-sm',
              active ? 'text-fg' : 'text-fg-muted hover:text-fg',
              item.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            {item.icon}
            {item.label}
            {item.count !== undefined && (
              <span className={cn('text-[11px] tabular-nums', active ? 'text-brand' : 'text-fg-subtle')}>{item.count}</span>
            )}
            {active && <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-pill bg-brand" />}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------ 折叠面板 */

export function Collapsible({
  open,
  children,
  className,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        className,
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- 分页 */

export function Pagination({
  page,
  total,
  pageSize,
  onChange,
  className,
}: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
  className?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;

  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  const end = Math.min(pages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const list = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  return (
    <nav className={cn('flex items-center justify-center gap-1', className)} aria-label="分页">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className="h-8 rounded-[6px] px-2.5 text-xs text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent"
      >
        上一页
      </button>
      {start > 1 && (
        <>
          <PageButton value={1} active={false} onClick={onChange} />
          {start > 2 && <span className="px-1 text-xs text-fg-subtle">…</span>}
        </>
      )}
      {list.map((value) => (
        <PageButton key={value} value={value} active={value === page} onClick={onChange} />
      ))}
      {end < pages && (
        <>
          {end < pages - 1 && <span className="px-1 text-xs text-fg-subtle">…</span>}
          <PageButton value={pages} active={false} onClick={onChange} />
        </>
      )}
      <button
        type="button"
        onClick={() => onChange(Math.min(pages, page + 1))}
        disabled={page === pages}
        className="h-8 rounded-[6px] px-2.5 text-xs text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent"
      >
        下一页
      </button>
    </nav>
  );
}

function PageButton({ value, active, onClick }: { value: number; active: boolean; onClick: (page: number) => void }) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={() => onClick(value)}
      className={cn(
        'size-8 rounded-[6px] text-xs tabular-nums transition-colors',
        active ? 'bg-fg font-semibold text-canvas' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
      )}
    >
      {value}
    </button>
  );
}
