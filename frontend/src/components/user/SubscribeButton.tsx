import { cn } from '@/lib/cn';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { Button, type ButtonProps } from '@/components/ui';

export interface SubscribeButtonProps extends Omit<ButtonProps, 'children' | 'onClick' | 'onToggle'> {
  active: boolean;
  onToggle: (next: boolean) => void;
  /** 频道场景用「订阅」，用户场景用「关注」 */
  labels?: { on: string; off: string };
  /** 互关标识（文档 2.2 关注/粉丝） */
  mutual?: boolean;
}

/**
 * 关注 / 订阅按钮（文档 12.3：点击后文案切换 + 背景色淡出过渡）
 */
export function SubscribeButton({
  active,
  onToggle,
  labels = { on: '已关注', off: '关注' },
  mutual,
  className,
  size = 'md',
  ...rest
}: SubscribeButtonProps) {
  const isLogin = useAuthStore((s) => s.status === 'authenticated');
  const toast = useUiStore((s) => s.toast);

  return (
    <Button
      {...rest}
      size={size}
      variant={active ? 'secondary' : 'primary'}
      aria-pressed={active}
      className={cn('transition-colors duration-200', className)}
      onClick={() => {
        if (!isLogin) {
          toast({ title: '登录后即可关注创作者', tone: 'warning' });
          return;
        }
        onToggle(!active);
      }}
    >
      {active ? (
        <>
          {labels.on}
          {mutual && <span className="ml-1 text-[11px] font-normal opacity-70">互关</span>}
        </>
      ) : (
        labels.off
      )}
    </Button>
  );
}
