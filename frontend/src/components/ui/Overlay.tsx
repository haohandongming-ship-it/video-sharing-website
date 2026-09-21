import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { EASE } from '@/lib/motion';
import { IconButton } from './Button';

/** 可聚焦元素选择器：用于焦点陷阱内的 Tab 循环。 */
const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function useLockBody(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}

function useEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, onClose]);
}

/**
 * 浮层焦点管理：打开时把焦点移入面板、Tab 循环留在面板内、关闭时把焦点还给触发元素。
 *
 * <p>此前 Modal / Drawer 只处理了 Escape 与 body 滚动锁定，打开时不移焦、不设焦点陷阱、
 * 关闭后也不还焦 —— Tab 可以一路穿透到背景内容，键盘与读屏用户会迷失在页面里。</p>
 */
function useFocusTrap(active: boolean, panelRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;

    const focusable = (): HTMLElement[] =>
      Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []).filter(
        (node) => node.offsetParent !== null,
      );

    // 打开后立即移焦：优先第一个可聚焦元素，面板本身兜底（面板带 tabIndex={-1}）。
    (focusable()[0] ?? panel)?.focus?.();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !panel) return;
      const list = focusable();
      if (list.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const current = document.activeElement as HTMLElement | null;
      const outside = !current || !panel.contains(current);
      if (event.shiftKey && (outside || current === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (outside || current === last)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [active, panelRef]);
}

/* ------------------------------------------------------------------ Modal */

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** 移动端是否以底部抽屉形式呈现 */
  mobileSheet?: boolean;
  className?: string;
  hideClose?: boolean;
}

const MODAL_SIZES = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  mobileSheet = true,
  className,
  hideClose,
}: ModalProps) {
  useLockBody(open);
  useEscape(open, onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panelRef);
  // 用可见标题作为无障碍名称（aria-labelledby），比 aria-label 更贴合屏幕阅读器的读法。
  const titleId = useId();

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-90 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-overlay"
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            initial={mobileSheet ? { opacity: 0, y: 24 } : { opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={mobileSheet ? { opacity: 0, y: 16 } : { opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.24, ease: EASE.enter }}
            className={cn(
              'relative flex w-full flex-col overflow-hidden border border-line bg-surface shadow-pop focus:outline-none',
              mobileSheet ? 'max-h-[88vh] rounded-t-2xl sm:rounded-card' : 'rounded-card',
              MODAL_SIZES[size],
              className,
            )}
          >
            <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2 id={titleId} className="text-base font-semibold text-fg">{title}</h2>
                {description && <p className="mt-1 text-xs leading-relaxed text-fg-muted">{description}</p>}
              </div>
              {!hideClose && (
                <IconButton label="关闭" size="icon-sm" onClick={onClose}>
                  <X className="size-4" />
                </IconButton>
              )}
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</footer>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/* ----------------------------------------------------------------- Drawer */

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: 'left' | 'right' | 'bottom';
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function Drawer({ open, onClose, title, side = 'right', children, footer, className }: DrawerProps) {
  useLockBody(open);
  useEscape(open, onClose);
  const panelRef = useRef<HTMLElement>(null);
  useFocusTrap(open, panelRef);
  const titleId = useId();

  const motionProps =
    side === 'left'
      ? { initial: { x: '-100%' }, animate: { x: 0 }, exit: { x: '-100%' } }
      : side === 'right'
        ? { initial: { x: '100%' }, animate: { x: 0 }, exit: { x: '100%' } }
        : { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' } };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-90" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-overlay"
            onClick={onClose}
          />
          <motion.aside
            ref={panelRef}
            tabIndex={-1}
            {...motionProps}
            transition={{ duration: 0.28, ease: EASE.enter }}
            className={cn(
              'absolute flex flex-col border-line bg-surface shadow-pop focus:outline-none',
              side === 'bottom'
                ? 'inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border-t'
                : side === 'left'
                  ? 'inset-y-0 left-0 w-[86vw] max-w-[320px] border-r'
                  : 'inset-y-0 right-0 w-[92vw] max-w-[420px] border-l',
              className,
            )}
          >
            <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <h2 id={titleId} className="text-sm font-semibold text-fg">{title}</h2>
              <IconButton label="关闭" size="icon-sm" onClick={onClose}>
                <X className="size-4" />
              </IconButton>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
            {footer && <footer className="border-t border-line px-4 py-3">{footer}</footer>}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}

/* --------------------------------------------------------------- Dropdown */

export interface DropdownItem {
  key: string;
  label: string;
  /** 次级说明文字，用于需要解释选项含义的菜单（如清晰度梯度） */
  description?: string;
  /** 当前选中项：显示勾选标记 */
  selected?: boolean;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  separatorBefore?: boolean;
}

export function Dropdown({
  trigger,
  items,
  align = 'end',
  side = 'bottom',
  className,
  panelClassName,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  items: DropdownItem[];
  align?: 'start' | 'end';
  /**
   * 弹出方向。默认向下；放在屏幕底部的触发器（如视频播放器控制条）必须传 'top'，
   * 否则面板会超出视口下沿被裁掉——这正是「倍速/清晰度菜单显示不全」的原因。
   */
  side?: 'top' | 'bottom';
  className?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const esc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: side === 'top' ? 4 : -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: side === 'top' ? 4 : -4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: EASE.enter }}
            role="menu"
            className={cn(
              'absolute z-70 min-w-44 overflow-hidden rounded-card border border-line bg-surface py-1 shadow-pop',
              side === 'top' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]',
              align === 'end' ? 'right-0' : 'left-0',
              panelClassName,
            )}
          >
            {items.map((item) => (
              <div key={item.key}>
                {item.separatorBefore && <div className="my-1 h-px bg-line" />}
                <button
                  type="button"
                  role="menuitem"
                  aria-checked={item.selected}
                  disabled={item.disabled}
                  onClick={() => {
                    if (item.disabled) return;
                    item.onSelect?.();
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-start gap-2.5 px-3 py-2 text-left text-[13px] transition-colors',
                    item.disabled
                      ? 'cursor-not-allowed text-fg-subtle'
                      : item.danger
                        ? 'text-brand hover:bg-brand-soft'
                        : 'text-fg hover:bg-surface-2',
                  )}
                >
                  {item.icon && <span className="shrink-0 text-current opacity-80">{item.icon}</span>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.label}</span>
                    {item.description && (
                      <span className="mt-0.5 block text-[11px] leading-snug text-fg-muted">{item.description}</span>
                    )}
                  </span>
                  {item.selected && <Check className="mt-0.5 size-3.5 shrink-0 text-accent" />}
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* -------------------------------------------------------------- Tooltip */

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

export function Tooltip({ content, children, side = 'top', className }: TooltipProps) {
  return (
    <span className={cn('group/tt relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-80 w-max max-w-56 rounded-[6px] bg-fg px-2 py-1 text-[11px] leading-snug font-medium text-canvas opacity-0 shadow-raised transition-opacity duration-150 group-hover/tt:opacity-100',
          side === 'top' && 'bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2',
          side === 'bottom' && 'top-[calc(100%+6px)] left-1/2 -translate-x-1/2',
          side === 'left' && 'top-1/2 right-[calc(100%+6px)] -translate-y-1/2',
          side === 'right' && 'top-1/2 left-[calc(100%+6px)] -translate-y-1/2',
        )}
      >
        {content}
      </span>
    </span>
  );
}
