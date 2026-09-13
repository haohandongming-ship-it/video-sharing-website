import { useState, type ReactNode } from 'react';
import { BadgeCheck, UserRound } from 'lucide-react';
import { cn } from '@/lib/cn';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

const SIZES: Record<AvatarSize, string> = {
  xs: 'size-6 text-[10px]',
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-12 text-base',
  xl: 'size-16 text-xl',
  '2xl': 'size-24 text-3xl',
};

export interface AvatarProps {
  src?: string | null;
  name: string;
  size?: AvatarSize;
  className?: string;
  /** 头像右下角认证标识 */
  certified?: boolean;
  ring?: boolean;
  onClick?: () => void;
}

export function Avatar({ src, name, size = 'md', className, certified, ring, onClick }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  return (
    <span className={cn('relative inline-block shrink-0', onClick && 'cursor-pointer', className)} onClick={onClick}>
      <span
        className={cn(
          'grid place-items-center overflow-hidden rounded-full bg-surface-3 font-semibold text-fg-muted select-none',
          ring && 'ring-2 ring-surface',
          SIZES[size],
        )}
      >
        {showImage ? (
          <img
            src={src as string}
            alt={name}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
            className="size-full object-cover"
          />
        ) : name ? (
          name.slice(0, 1)
        ) : (
          <UserRound className="size-1/2" aria-hidden />
        )}
      </span>
      {certified && (
        <BadgeCheck
          className="absolute -right-0.5 -bottom-0.5 size-4 rounded-full bg-surface text-accent"
          aria-label="已认证创作者"
        />
      )}
    </span>
  );
}

export interface AvatarWithMetaProps {
  src?: string | null;
  name: string;
  meta?: ReactNode;
  size?: AvatarSize;
  certified?: boolean;
  className?: string;
  onClick?: () => void;
}

export function AvatarWithMeta({ src, name, meta, size = 'md', certified, className, onClick }: AvatarWithMetaProps) {
  return (
    <div className={cn('flex min-w-0 items-center gap-3', className)}>
      <Avatar src={src} name={name} size={size} certified={certified} onClick={onClick} />
      <div className="min-w-0">
        <div
          className={cn('truncate text-sm font-medium text-fg', onClick && 'cursor-pointer hover:text-accent')}
          onClick={onClick}
        >
          {name}
        </div>
        {meta && <div className="truncate text-xs text-fg-muted">{meta}</div>}
      </div>
    </div>
  );
}
