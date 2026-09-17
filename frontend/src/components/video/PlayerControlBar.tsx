import { useState } from 'react';
import {
  Gauge,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Settings2,
  Subtitles,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { QUALITY_TIERS, RATE_OPTIONS } from '@/lib/constants';
import { Dropdown, IconButton, Tooltip } from '@/components/ui';

export interface PlayerControlBarProps {
  playing: boolean;
  currentTime: number;
  duration: number;
  bufferedPercent: number;
  muted: boolean;
  volume: number;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  onVolumeChange: (volume: number) => void;
  onSeek: (time: number) => void;
  /** 倍速偏好与设置 */
  rate: number;
  onRateChange: (rate: number) => void;
  /** 清晰度：levels 为空时显示「原画」并禁用切换 */
  levels: { index: number; name: string; height: number }[];
  quality: string | null;
  onQualityChange: (tier: string | null, levelIndex: number) => void;
  /** 字幕：无轨道时给出明确提示而不是无效开关 */
  hasSubtitles: boolean;
  subtitlesOn: boolean;
  onToggleSubtitles: () => void;
  /** 弹幕开关（长视频没有，短视频需要） */
  danmakuSlot?: React.ReactNode;
  /** 画中画 / 全屏 */
  onTogglePip: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onHint?: (text: string) => void;
  className?: string;
}

/**
 * 播放器控制栏（长视频与短视频共用）。
 *
 * <p>抽出来的原因：短视频此前用的是文字胶囊（1.0x / 0.75x / 原画 / 无字幕），
 * 与长视频的图标控件完全两套；共用之后两处的图标、层级菜单与交互保持一致。
 */
export function PlayerControlBar({
  playing,
  currentTime,
  duration,
  bufferedPercent,
  muted,
  volume,
  onTogglePlay,
  onToggleMute,
  onVolumeChange,
  onSeek,
  rate,
  onRateChange,
  levels,
  quality,
  onQualityChange,
  hasSubtitles,
  subtitlesOn,
  onToggleSubtitles,
  danmakuSlot,
  onTogglePip,
  fullscreen,
  onToggleFullscreen,
  onHint,
  className,
}: PlayerControlBarProps) {
  const [rateOpen, setRateOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);

  const percent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const qualityLabel = quality
    ? (QUALITY_TIERS.find((tier) => tier.value === quality)?.label ?? '自动')
    : '自动';

  return (
    <div className={cn('flex flex-col gap-1 text-white', className)} style={{ '--pcb-height': '5.5rem' } as React.CSSProperties}>
      {/* 进度条 */}
      <div
        className="group/bar relative h-3 cursor-pointer"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
          onSeek(ratio * duration);
        }}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
          setHoverTime(ratio * duration);
          setHoverX(event.clientX - rect.left);
        }}
        onMouseLeave={() => setHoverTime(null)}
        role="slider"
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentTime)}
        tabIndex={0}
      >
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-pill bg-white/25 transition-[height] group-hover/bar:h-1.5">
          <div className="h-full rounded-pill bg-white/35" style={{ width: `${bufferedPercent}%` }} />
          <div className="absolute inset-y-0 left-0 rounded-pill bg-brand" style={{ width: `${percent}%` }} />
          <div
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand opacity-0 transition-opacity group-hover/bar:opacity-100"
            style={{ left: `${percent}%` }}
          />
        </div>
        {hoverTime !== null && (
          <div
            className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded-[6px] bg-black/85 px-2 py-1 text-[11px] tabular-nums text-white"
            style={{ left: hoverX }}
          >
            {formatDuration(hoverTime)}
          </div>
        )}
      </div>

      {/* 按钮区 */}
      <div className="flex items-center gap-1">
        <IconButton
          label={playing ? '暂停 (K)' : '播放 (K)'}
          variant="ghost"
          size="icon-sm"
          className="text-white hover:bg-white/15 hover:text-white"
          onClick={onTogglePlay}
        >
          {playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
        </IconButton>

        <div className="group/vol flex items-center">
          <IconButton
            label={muted ? '取消静音 (M)' : '静音 (M)'}
            variant="ghost"
            size="icon-sm"
            className="text-white hover:bg-white/15 hover:text-white"
            onClick={onToggleMute}
          >
            <VolumeIcon className="size-4" />
          </IconButton>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            aria-label="音量"
            onChange={(event) => onVolumeChange(Number(event.target.value))}
            className="range-media h-1 w-0 opacity-0 transition-[width,opacity] duration-200 group-hover/vol:w-20 group-hover/vol:opacity-100 focus:w-20 focus:opacity-100"
          />
        </div>

        <span className="ml-1 text-xs tabular-nums text-white/90">
          {formatDuration(currentTime)} / {formatDuration(duration)}
        </span>

        <div className="ml-auto flex items-center gap-0.5">
          {danmakuSlot}

          <Dropdown
            align="end"
            side="top"
            items={RATE_OPTIONS.map((option) => ({
              key: String(option),
              label: option === 1 ? '正常速度' : `${option}x`,
              selected: rate === option,
              onSelect: () => {
                onRateChange(option);
                onHint?.(option === 1 ? '正常速度' : `倍速 ${option}x`);
              },
            }))}
            trigger={({ toggle }) => (
              <Tooltip content="播放速度">
                <IconButton
                  label="播放速度"
                  variant="ghost"
                  size="icon-sm"
                  className="text-white hover:bg-white/15 hover:text-white"
                  onClick={() => {
                    setRateOpen((v) => !v);
                    toggle();
                  }}
                >
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums">
                    {rate === 1 && !rateOpen ? <Gauge className="size-4" /> : `${rate}x`}
                  </span>
                </IconButton>
              </Tooltip>
            )}
          />

          <Dropdown
            align="end"
            side="top"
            items={
              // 没有多档清单时只给一项说明，而不是列出 4 个永远禁用的档位
              levels.length === 0
                ? [
                    {
                      key: 'source',
                      label: '原画',
                      description: '该视频没有多档清晰度',
                      selected: true,
                      onSelect: () => onHint?.('该视频只有原画'),
                    },
                  ]
                : QUALITY_TIERS.map((tier) => {
                    const wanted = Number.parseInt(String(tier.value ?? ''), 10);
                    const target = levels.reduce(
                      (best, level) =>
                        Math.abs(level.height - wanted) < Math.abs(best.height - wanted) ? level : best,
                      levels[0],
                    );
                    const actual = Number.isFinite(wanted) ? target.name : null;
                    const description =
                      actual && actual !== tier.label.toLowerCase()
                        ? `${tier.description}（本视频为 ${actual}）`
                        : tier.description;
                    return {
                      key: tier.value ?? 'auto',
                      label: tier.label,
                      description,
                      selected: (quality ?? null) === tier.value,
                      onSelect: () => {
                        onQualityChange(tier.value, target.index);
                        onHint?.(tier.value ? `清晰度 ${actual ?? tier.label}` : '清晰度自动');
                      },
                    };
                  })
            }
            trigger={({ toggle }) => (
              <Tooltip content="清晰度">
                <IconButton
                  label="清晰度"
                  variant="ghost"
                  size="icon-sm"
                  className="text-white hover:bg-white/15 hover:text-white"
                  onClick={() => {
                    setQualityOpen((v) => !v);
                    toggle();
                  }}
                >
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold">
                    <Settings2 className="size-3.5" />
                    {qualityOpen ? '' : levels.length ? qualityLabel : '原画'}
                  </span>
                </IconButton>
              </Tooltip>
            )}
          />

          <Tooltip content={hasSubtitles ? '字幕 (C)' : '该视频没有字幕文件'}>
            <IconButton
              label="字幕"
              variant="ghost"
              size="icon-sm"
              disabled={!hasSubtitles}
              className={cn(
                'text-white hover:bg-white/15 hover:text-white',
                hasSubtitles && subtitlesOn && 'text-brand',
                !hasSubtitles && 'opacity-45',
              )}
              onClick={() => {
                if (!hasSubtitles) {
                  onHint?.('该视频没有字幕文件');
                  return;
                }
                onToggleSubtitles();
                onHint?.(subtitlesOn ? '关闭字幕' : '开启字幕');
              }}
            >
              <Subtitles className="size-4" />
            </IconButton>
          </Tooltip>

          <Tooltip content="画中画">
            <IconButton
              label="画中画"
              variant="ghost"
              size="icon-sm"
              className="text-white hover:bg-white/15 hover:text-white"
              onClick={onTogglePip}
            >
              <PictureInPicture2 className="size-4" />
            </IconButton>
          </Tooltip>

          <Tooltip content={fullscreen ? '退出全屏 (F)' : '全屏 (F)'}>
            <IconButton
              label={fullscreen ? '退出全屏' : '全屏'}
              variant="ghost"
              size="icon-sm"
              className="text-white hover:bg-white/15 hover:text-white"
              onClick={onToggleFullscreen}
            >
              {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
            </IconButton>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
