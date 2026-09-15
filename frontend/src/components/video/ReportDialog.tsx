import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { REPORT_REASONS } from '@/lib/constants';
import { videoApi } from '@/api/videos';
import { useUiStore } from '@/stores/uiStore';
import { Button, Input, Modal, Textarea } from '@/components/ui';
import type { ReportReason } from '@/api/types';

export interface ReportDialogProps {
  open: boolean;
  onClose: () => void;
  targetType: 'VIDEO' | 'COMMENT' | 'FEED' | 'USER';
  targetId: number;
  targetTitle?: string;
}

/** 举报弹窗：类型 + 描述 → 进入审核队列（文档 11.4） */
export function ReportDialog({ open, onClose, targetType, targetId, targetTitle }: ReportDialogProps) {
  const toast = useUiStore((s) => s.toast);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [description, setDescription] = useState('');
  const [contact, setContact] = useState('');
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!reason) {
      toast({ title: '请选择举报类型', tone: 'warning' });
      return;
    }
    setPending(true);
    try {
      const details = [description.trim(), contact.trim() ? `联系方式：${contact.trim()}` : ''].filter(Boolean).join('\n');
      const result = await videoApi.report({ targetType, targetId, reason, description: details || undefined });
      setDone(true);
      toast({ title: '举报已提交', description: `受理编号 #${result.reportId}，我们会尽快处理`, tone: 'success' });
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : '举报提交失败，请重试', tone: 'error' });
    } finally {
      setPending(false);
    }
  };

  const reset = () => {
    setReason(null);
    setDescription('');
    setContact('');
    setDone(false);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={reset}
      title={done ? '举报已受理' : '举报内容'}
      description={done ? undefined : targetTitle}
      size="md"
      footer={
        done ? (
          <Button variant="primary" onClick={reset}>
            完成
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={reset}>
              取消
            </Button>
            <Button variant="primary" loading={pending} onClick={() => void submit()}>
              提交举报
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-success-soft text-success">
            <AlertTriangle className="size-6" />
          </div>
          <p className="text-sm leading-relaxed text-fg-muted">
            感谢你的反馈。审核团队将在 24 小时内处理，处理结果会通过站内通知告知。
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-2 text-xs font-medium text-fg-muted">举报类型</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {REPORT_REASONS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setReason(item.value)}
                  className={
                    reason === item.value
                      ? 'h-9 rounded-btn border border-accent bg-accent-soft text-[13px] font-medium text-accent'
                      : 'h-9 rounded-btn border border-line bg-surface text-[13px] text-fg-muted transition-colors hover:border-fg-subtle hover:text-fg'
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-fg-muted">
              补充说明<span className="ml-1 text-fg-subtle">（选填，最多 500 字）</span>
            </p>
            <Textarea
              aria-label="举报补充说明"
              rows={4}
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="请描述具体问题，例如出现时间点、涉及的内容等，有助于我们更快处理。"
              footer={
                <span className="text-[11px] text-fg-subtle tabular-nums">{description.length}/500</span>
              }
            />
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-fg-muted">
              联系方式<span className="ml-1 text-fg-subtle">（选填，便于跟进）</span>
            </p>
            <Input
              aria-label="举报联系方式"
              maxLength={150}
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              placeholder="邮箱或手机号"
            />
          </div>

          <p className="rounded-btn bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-fg-muted">
            恶意举报可能会影响你的账号信用分。我们承诺对举报人信息保密，详见《社区规范》与《隐私政策》。
          </p>
        </div>
      )}
    </Modal>
  );
}
