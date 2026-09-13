import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'link';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm' | 'icon-lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand text-white hover:bg-brand-hover active:bg-brand-hover shadow-[0_1px_2px_rgba(0,0,0,0.12)] disabled:bg-brand/50',
  secondary: 'bg-surface-2 text-fg hover:bg-surface-3 active:bg-surface-3',
  ghost: 'text-fg-muted hover:bg-surface-2 hover:text-fg',
  outline: 'border border-line bg-surface text-fg hover:bg-surface-2',
  danger: 'bg-brand text-white hover:bg-brand-hover',
  link: 'text-accent hover:underline underline-offset-4 px-0 h-auto',
};

const SIZES: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-xs gap-1 rounded-[6px]',
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-[6px]',
  md: 'h-10 px-4 text-sm gap-2 rounded-btn',
  lg: 'h-12 px-6 text-[15px] gap-2 rounded-btn',
  icon: 'size-10 rounded-btn',
  'icon-sm': 'size-8 rounded-[6px]',
  'icon-lg': 'size-12 rounded-full',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** 加载态替换文案（文档 12.2：按钮内 spinner + 「处理中...」） */
  loadingText?: string;
  icon?: ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'secondary',
    size = 'md',
    loading = false,
    loadingText,
    icon,
    fullWidth,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-medium whitespace-nowrap select-none',
        'transition-[background-color,color,transform,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
        'disabled:opacity-60 disabled:pointer-events-none',
        'active:scale-[0.98]',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden /> : icon}
      {loading && loadingText ? loadingText : children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, 'size' | 'icon' | 'children'> {
  size?: Extract<ButtonSize, 'icon' | 'icon-sm' | 'icon-lg'>;
  label: string;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, className, variant = 'ghost', size = 'icon', children, ...rest },
  ref,
) {
  return (
    <Button
      ref={ref}
      aria-label={label}
      title={label}
      variant={variant}
      size={size}
      className={cn('shrink-0', className)}
      {...rest}
    >
      {children}
    </Button>
  );
});

/** 点赞类「图标 + 计数」按钮，带弹跳动效（文档 12.3） */
export interface PillActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  activeClassName?: string;
  layout?: 'horizontal' | 'vertical';
}

export const PillAction = forwardRef<HTMLButtonElement, PillActionProps>(function PillAction(
  { icon, label, count, active, activeClassName, layout = 'horizontal', className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        'group inline-flex items-center gap-1.5 rounded-pill text-[13px] font-medium text-fg-muted',
        'transition-colors duration-150 hover:text-fg',
        layout === 'horizontal' ? 'h-9 px-3 hover:bg-surface-2' : 'flex-col gap-0.5 px-1 py-1',
        active && (activeClassName ?? 'text-brand'),
        className,
      )}
      {...rest}
    >
      <span className={cn('grid place-items-center transition-transform', active && 'animate-[bounce-like_0.3s_cubic-bezier(0.34,1.56,0.64,1)]')}>
        {icon}
      </span>
      {count !== undefined && <span className="tabular-nums">{count > 0 ? count.toLocaleString('zh-CN') : ''}</span>}
    </button>
  );
});
