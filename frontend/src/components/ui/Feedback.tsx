import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'brand' | 'accent' | 'success' | 'warning' | 'danger';
  size?: 'sm' | 'md';
  icon?: ReactNode;
}

const TONES: Record<NonNullable<BadgeProps['tone']>, string> = {
  neutral: 'bg-surface-2 text-fg-muted',
  brand: 'bg-brand-soft text-brand',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-brand-soft text-brand',
};

export function Badge({ className, tone = 'neutral', size = 'sm', icon, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[6px] font-medium whitespace-nowrap',
        size === 'sm' ? 'h-5 px-1.5 text-[11px]' : 'h-6 px-2 text-xs',
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}

export interface TagProps {
  label: string;
  onRemove?: () => void;
  onClick?: () => void;
  active?: boolean;
  className?: string;
  size?: 'sm' | 'md';
}

export function Tag({ label, onRemove, onClick, active, className, size = 'md' }: TagProps) {
  const Component = onClick ? 'button' : 'span';
  return (
    <Component
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-pill border font-medium transition-colors duration-150',
        size === 'sm' ? 'h-6 px-2 text-[11px]' : 'h-7 px-3 text-xs',
        active
          ? 'border-transparent bg-fg text-canvas'
          : 'border-line bg-surface text-fg-muted hover:border-fg-subtle hover:text-fg',
        className,
      )}
    >
      {label}
      {onRemove && (
        <span
          role="button"
          tabIndex={0}
          aria-label={`移除 ${label}`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.stopPropagation();
              onRemove();
            }
          }}
          className="grid size-3.5 place-items-center rounded-full hover:bg-fg/10"
        >
          ×
        </span>
      )}
    </Component>
  );
}

export interface ProgressBarProps {
  value: number;
  max?: number;
  className?: string;
  tone?: 'brand' | 'accent' | 'success';
  size?: 'xs' | 'sm' | 'md';
  buffered?: number;
  indeterminate?: boolean;
}

const PROGRESS_TONES = {
  brand: 'bg-brand',
  accent: 'bg-accent',
  success: 'bg-success',
};

export function ProgressBar({
  value,
  max = 100,
  className,
  tone = 'brand',
  size = 'sm',
  buffered,
  indeterminate,
}: ProgressBarProps) {
  const percent = Math.min(100, Math.max(0, (value / max) * 100));
  const bufferedPercent = buffered === undefined ? null : Math.min(100, Math.max(0, (buffered / max) * 100));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        'relative w-full overflow-hidden rounded-pill bg-surface-3',
        size === 'xs' ? 'h-0.5' : size === 'sm' ? 'h-1' : 'h-1.5',
        className,
      )}
    >
      {bufferedPercent !== null && (
        <div className="absolute inset-y-0 left-0 rounded-pill bg-fg-subtle/40" style={{ width: `${bufferedPercent}%` }} />
      )}
      <div
        className={cn(
          'relative h-full rounded-pill transition-[width] duration-200',
          PROGRESS_TONES[tone],
          indeterminate && 'animate-pulse',
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/** 环形进度：上传/转码大进度展示 */
export function RingProgress({
  value,
  size = 72,
  strokeWidth = 5,
  children,
  className,
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
  children?: ReactNode;
  className?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const percent = Math.min(100, Math.max(0, value));
  const offset = circumference - (percent / 100) * circumference;
  return (
    <div className={cn('relative grid place-items-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--c-surface-3)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--c-brand)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-300 ease-out"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-sm font-semibold tabular-nums">{children}</div>
    </div>
  );
}
