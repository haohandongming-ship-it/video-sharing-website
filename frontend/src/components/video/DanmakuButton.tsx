import { useEffect, useRef, useState } from 'react';
import { MessageSquareText, Send, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton, Tooltip } from '@/components/ui';

export interface DanmakuButtonProps {
  enabled: boolean;
  onToggleEnabled: () => void;
  onSend: (content: string) => Promise<void> | void;
  /** 定位到当前播放时间点，仅用于提示文案 */
  currentTime: number;
  maxLength?: number;
  className?: string;
}

/**
 * 弹幕按钮 + 弹出输入框。
 *
 * <p>此前是一整条常驻的输入框，和播放器控制栏挤在同一块底部区域，把控制栏压住了。
 * 现在收敛成一个按钮：点击展开输入框，发送后自动收起；右侧的「弹幕开关」另有一个小圆点表示启用状态。
 */
export function DanmakuButton({ enabled, onToggleEnabled, onSend, currentTime, maxLength = 200, className }: DanmakuButtonProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const submit = async () => {
    const content = draft.trim();
    if (!content || pending) return;
    setPending(true);
    try {
      await onSend(content);
      setDraft('');
      setOpen(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={cn('relative flex items-center', className)}>
      <Tooltip content={enabled ? '发弹幕（发送中显示）' : '弹幕已关闭'}>
        <IconButton
          label="发弹幕"
          variant="ghost"
          size="icon-sm"
          className={cn('text-white hover:bg-white/15 hover:text-white', enabled && 'text-brand')}
          onClick={() => setOpen((v) => !v)}
        >
          <MessageSquareText className="size-4" />
        </IconButton>
      </Tooltip>

      {open && (
        <div
          /*
           * 浮层叠在视频之上，视频本身可能很暗，仅靠半透明背景会糊成一片；
           * 因此用接近不透明的底色 + 描边 + 阴影，保证输入区始终清晰可读。
           * z-50 高于控制栏（z-20）与弹幕层（z-10），避免被压住或被裁剪。
           */
          className="absolute right-0 bottom-[calc(100%+10px)] z-50 w-[min(22rem,72vw)] rounded-card border border-white/25 bg-[#232733] p-3 shadow-[0_10px_30px_rgba(0,0,0,0.85)]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium text-white">
              弹幕将出现在 {Math.floor(currentTime / 60)}:{String(Math.floor(currentTime % 60)).padStart(2, '0')}
            </span>
            <button
              type="button"
              aria-label="关闭弹幕输入"
              onClick={() => setOpen(false)}
              className="grid size-5 place-items-center rounded-full text-white/70 transition-colors hover:bg-white/20 hover:text-white"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void submit();
                }
                if (event.key === 'Escape') setOpen(false);
              }}
              maxLength={maxLength}
              placeholder="发一条弹幕，回车发送"
              aria-label="弹幕内容"
              className="h-9 min-w-0 flex-1 rounded-pill border border-white/35 bg-white/15 px-3 text-[12px] text-white placeholder:text-white/60 focus:border-brand focus:outline-none"
            />
            <button
              type="button"
              aria-label="发送弹幕"
              disabled={pending || draft.trim().length === 0}
              onClick={() => void submit()}
              className="grid size-9 shrink-0 place-items-center rounded-full bg-brand text-white transition-opacity disabled:opacity-40"
            >
              <Send className="size-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={onToggleEnabled}
            className="mt-2 w-full rounded-btn border border-white/20 bg-white/5 px-2 py-1.5 text-left text-[11px] text-white/85 transition-colors hover:border-white/40 hover:text-white"
          >
            {enabled ? '点击关闭弹幕显示' : '点击开启弹幕显示'}
          </button>
        </div>
      )}
    </div>
  );
}
