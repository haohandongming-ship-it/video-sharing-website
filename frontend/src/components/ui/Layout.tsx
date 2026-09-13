import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** 统一页面容器：控制最大宽度与响应式内边距 */
export function PageContainer({
  children,
  className,
  size = 'default',
  as: Component = 'div',
}: {
  children: ReactNode;
  className?: string;
  size?: 'default' | 'wide' | 'narrow' | 'full';
  as?: 'div' | 'main' | 'section';
}) {
  return (
    <Component
      className={cn(
        'mx-auto w-full px-4 sm:px-6',
        size === 'narrow' && 'max-w-3xl',
        size === 'default' && 'max-w-[1600px]',
        size === 'wide' && 'max-w-[2000px]',
        size === 'full' && 'max-w-none',
        className,
      )}
    >
      {children}
    </Component>
  );
}

export function SectionHeader({
  title,
  subtitle,
  action,
  className,
  level = 2,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
  level?: 1 | 2 | 3;
}) {
  const Heading = (level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3') as 'h1' | 'h2' | 'h3';
  return (
    <div className={cn('flex items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        <Heading
          className={cn(
            'font-semibold tracking-[-0.01em] text-fg',
            level === 1 ? 'text-xl sm:text-2xl' : level === 2 ? 'text-base sm:text-lg' : 'text-sm',
          )}
        >
          {title}
        </Heading>
        {subtitle && <p className="mt-1 text-xs leading-relaxed text-fg-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function SurfaceCard({
  children,
  className,
  padded = true,
  interactive,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  interactive?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-card border border-line bg-surface',
        padded && 'p-4 sm:p-5',
        interactive &&
          'cursor-pointer transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1 hover:shadow-raised',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Divider({ className, label }: { className?: string; label?: string }) {
  if (label) {
    return (
      <div className={cn('flex items-center gap-3', className)}>
        <span className="h-px flex-1 bg-line" />
        <span className="text-[11px] tracking-wide text-fg-subtle">{label}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
    );
  }
  return <div className={cn('h-px w-full bg-line', className)} />;
}

export function StatTile({
  label,
  value,
  delta,
  hint,
  icon,
  className,
}: {
  label: string;
  value: ReactNode;
  delta?: number;
  hint?: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-card border border-line bg-surface p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-fg-muted">{label}</span>
        {icon && <span className="text-fg-subtle">{icon}</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-[-0.02em] tabular-nums text-fg">{value}</span>
        {delta !== undefined && (
          <span className={cn('text-xs font-medium tabular-nums', delta >= 0 ? 'text-success' : 'text-brand')}>
            {delta >= 0 ? '+' : ''}
            {delta}%
          </span>
        )}
      </div>
      {hint && <p className="mt-1 text-[11px] text-fg-subtle">{hint}</p>}
    </div>
  );
}
