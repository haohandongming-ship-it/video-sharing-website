import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode;
  suffix?: ReactNode;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, icon, suffix, invalid, ...rest },
  ref,
) {
  return (
    <div
      className={cn(
        'flex h-10 items-center gap-2 rounded-btn border bg-surface px-3',
        'transition-colors duration-150 focus-within:border-accent',
        invalid ? 'border-brand' : 'border-line',
        className,
      )}
      data-invalid={invalid ? '' : undefined}
    >
      {icon && <span className="shrink-0 text-fg-subtle">{icon}</span>}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-subtle"
        {...rest}
      />
      {suffix}
    </div>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  footer?: ReactNode;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, footer, ...rest },
  ref,
) {
  return (
    <div
      className={cn(
        'rounded-btn border bg-surface transition-colors duration-150 focus-within:border-accent',
        invalid ? 'border-brand' : 'border-line',
      )}
      data-invalid={invalid ? '' : undefined}
    >
      <textarea
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'w-full resize-none bg-transparent px-3 py-2.5 text-sm leading-relaxed outline-none placeholder:text-fg-subtle',
          className,
        )}
        {...rest}
      />
      {footer && <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">{footer}</div>}
    </div>
  );
});

export interface SearchInputProps extends Omit<InputProps, 'icon' | 'type'> {
  onClear?: () => void;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onClear, className, ...rest },
  ref,
) {
  return (
    <Input
      ref={ref}
      type="search"
      icon={<Search className="size-4" aria-hidden />}
      value={value}
      className={cn('rounded-pill pl-3', className)}
      suffix={
        value ? (
          <button
            type="button"
            aria-label="清空搜索"
            onClick={onClear}
            className="grid size-5 shrink-0 place-items-center rounded-full text-fg-subtle hover:bg-surface-3 hover:text-fg"
          >
            <X className="size-3.5" />
          </button>
        ) : null
      }
      {...rest}
    />
  );
});

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

export function Switch({ checked, onChange, label, description, disabled, className, id }: SwitchProps) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex items-start justify-between gap-4',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        className,
      )}
    >
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-medium text-fg">{label}</span>}
          {description && <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">{description}</span>}
        </span>
      )}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors duration-200',
          checked ? 'bg-accent' : 'bg-surface-3',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </label>
  );
}

export interface RadioGroupProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; description?: string }[];
  className?: string;
  name?: string;
}

export function RadioGroup<T extends string>({ value, onChange, options, className, name }: RadioGroupProps<T>) {
  return (
    <div className={cn('flex flex-col gap-2', className)} role="radiogroup">
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-btn border px-3 py-2.5 transition-colors',
            value === option.value ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2',
          )}
        >
          <input
            type="radio"
            name={name}
            className="mt-1 size-3.5 accent-[var(--c-accent)]"
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-fg">{option.label}</span>
            {option.description && <span className="mt-0.5 block text-xs text-fg-muted">{option.description}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}
