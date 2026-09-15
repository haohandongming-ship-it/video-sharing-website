import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { EASE } from '@/lib/motion';
import { useUiStore, type ToastTone } from '@/stores/uiStore';
import { Button } from './Button';
import { Modal } from './Overlay';

const TONE_STYLES: Record<ToastTone, { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: 'text-accent' },
  success: { icon: CheckCircle2, className: 'text-success' },
  warning: { icon: AlertTriangle, className: 'text-warning' },
  error: { icon: XCircle, className: 'text-brand' },
};

export function Toaster() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-100 flex flex-col items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:bottom-auto sm:top-4 sm:items-end"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const { icon: Icon, className } = TONE_STYLES[toast.tone];
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.22, ease: EASE.enter }}
              className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card border border-line bg-surface px-3.5 py-3 shadow-pop"
              role="status"
            >
              <Icon className={cn('mt-0.5 size-4 shrink-0', className)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-snug font-medium text-fg">{toast.title}</p>
                {toast.description && <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{toast.description}</p>}
                {toast.action && (
                  <button
                    type="button"
                    onClick={() => {
                      toast.action?.onClick?.();
                      dismiss(toast.id);
                    }}
                    className="mt-1.5 text-xs font-medium text-accent hover:underline"
                  >
                    {toast.action.label}
                  </button>
                )}
              </div>
              <button
                type="button"
                aria-label="关闭提示"
                onClick={() => dismiss(toast.id)}
                className="grid size-5 shrink-0 place-items-center rounded-full text-fg-subtle hover:bg-surface-2 hover:text-fg"
              >
                <X className="size-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/** 全局二次确认（关键操作：删除/注销/封禁，文档 13.1 关键操作二次确认） */
export function ConfirmDialog() {
  // 提交中标记绑定到具体的确认请求：换一个弹窗（confirm 是新的对象）时自动回到未提交状态，
  // 不需要用 effect 同步，也不会出现「上一次请求进行中被关掉，下一个弹窗一直转圈」。
  const [pendingOwner, setPendingOwner] = useState<unknown>(null);
  const confirm = useUiStore((s) => s.confirm);
  const close = useUiStore((s) => s.closeConfirm);
  const pending = pendingOwner !== null && pendingOwner === confirm;

  return (
    <Modal
      open={confirm.open}
      onClose={() => {
        if (pending) return;
        confirm.onCancel?.();
        close();
      }}
      title={confirm.title}
      description={confirm.description}
      size="sm"
      hideClose
      footer={
        <>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              confirm.onCancel?.();
              close();
            }}
          >
            {confirm.cancelText}
          </Button>
          <Button
            variant={confirm.danger ? 'danger' : 'primary'}
            loading={pending}
            onClick={async () => {
              setPendingOwner(confirm);
              try { await confirm.onConfirm?.(); close(); }
              catch (error) { useUiStore.getState().toast({ title: error instanceof Error ? error.message : '操作失败，请重试', tone: 'error' }); }
              finally { setPendingOwner(null); }
            }}
          >
            {confirm.confirmText}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-fg-muted">
        请确认后继续。
      </p>
    </Modal>
  );
}
