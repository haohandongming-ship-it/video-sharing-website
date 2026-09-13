import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy, Link2, MessageCircle, Send, Share2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { EASE } from '@/lib/motion';
import { useUiStore } from '@/stores/uiStore';
import { Button, Modal } from '@/components/ui';

export interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** 站内分享路径，用于生成完整链接 */
  path: string;
  coverUrl?: string;
}

/** 分享面板：站内 / 微信 / 微博 / 复制链接（文档 3.3 分享） */
export function ShareDialog({ open, onClose, title, path, coverUrl }: ShareDialogProps) {
  const toast = useUiStore((s) => s.toast);
  const [copied, setCopied] = useState(false);
  const url = typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // 剪贴板不可用时降级为手动选择
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
    setCopied(true);
    toast({ title: '链接已复制', description: '可直接粘贴分享给好友', tone: 'success' });
    window.setTimeout(() => setCopied(false), 2000);
  };

  const targets = [
    {
      key: 'wechat',
      label: '微信',
      icon: <MessageCircle className="size-5" />,
      className: 'bg-[#07c160] text-white',
      onClick: () => toast({ title: '请使用微信扫描二维码分享', description: '移动端可直接唤起微信', tone: 'info' }),
    },
    {
      key: 'weibo',
      label: '微博',
      icon: <Send className="size-5" />,
      className: 'bg-[#e6162d] text-white',
      onClick: () => {
        window.open(
          `https://service.weibo.com/share/share.php?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}${coverUrl ? `&pic=${encodeURIComponent(coverUrl)}` : ''}`,
          '_blank',
          'noopener,noreferrer',
        );
      },
    },
    {
      key: 'internal',
      label: '站内私信',
      icon: <Share2 className="size-5" />,
      className: 'bg-accent text-white',
      onClick: () => {
        toast({ title: '请选择好友后发送', tone: 'info' });
        onClose();
      },
    },
  ];

  return (
    <Modal open={open} onClose={onClose} title="分享" description={title} size="sm">
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3">
          {coverUrl && (
            <img src={coverUrl} alt="" className="aspect-video w-24 shrink-0 rounded-[8px] object-cover" loading="lazy" />
          )}
          <p className="line-clamp-2 text-sm leading-relaxed text-fg">{title}</p>
        </div>

        <div className="flex items-center gap-4">
          {targets.map((target) => (
            <button
              key={target.key}
              type="button"
              onClick={target.onClick}
              className="group flex flex-col items-center gap-1.5"
            >
              <span
                className={cn(
                  'grid size-11 place-items-center rounded-full transition-transform duration-200 group-hover:scale-105',
                  target.className,
                )}
              >
                {target.icon}
              </span>
              <span className="text-xs text-fg-muted">{target.label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 rounded-btn border border-line bg-surface-2 px-3 py-2">
          <Link2 className="size-4 shrink-0 text-fg-subtle" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{url}</span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={copied ? 'done' : 'idle'}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: EASE.enter }}
            >
              <Button
                size="xs"
                variant={copied ? 'secondary' : 'primary'}
                icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                onClick={() => void copy()}
              >
                {copied ? '已复制' : '复制'}
              </Button>
            </motion.span>
          </AnimatePresence>
        </div>
      </div>
    </Modal>
  );
}
