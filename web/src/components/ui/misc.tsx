import * as AvatarPrimitive from '@radix-ui/react-avatar';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import { motion } from 'motion/react';
import { useId, type ReactNode } from 'react';
import { cn, initials } from '@/lib/utils';

// --- Avatar -----------------------------------------------------------------

const sizes = { xs: 'size-5 text-[9px]', sm: 'size-7 text-[11px]', md: 'size-9 text-xs', lg: 'size-12 text-sm', xl: 'size-[72px] text-xl' };

export function Avatar({
  src,
  name,
  size = 'md',
  className,
  square,
}: {
  src?: string | null;
  name?: string | null;
  size?: keyof typeof sizes;
  className?: string;
  square?: boolean;
}) {
  // LinkedIn's generic grey silhouette reads worse than initials.
  const photo = src && !src.includes('static.licdn.com') ? src : null;
  return (
    <AvatarPrimitive.Root
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden bg-surface-3 font-medium text-ink-2',
        square ? 'rounded-lg' : 'rounded-full',
        sizes[size],
        className,
      )}
    >
      {photo && <AvatarPrimitive.Image src={photo} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />}
      <AvatarPrimitive.Fallback delayMs={photo ? 400 : 0}>{initials(name)}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

// --- Checkbox ---------------------------------------------------------------

export function Checkbox({
  checked,
  onCheckedChange,
  className,
  ...rest
}: {
  checked: boolean | 'indeterminate';
  onCheckedChange: (v: boolean) => void;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <CheckboxPrimitive.Root
      checked={checked}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-[5px] border border-line-strong bg-surface transition-colors hover:border-ink-4 data-[state=checked]:border-ink data-[state=checked]:bg-ink data-[state=indeterminate]:border-ink data-[state=indeterminate]:bg-ink',
        className,
      )}
      {...rest}
    >
      <CheckboxPrimitive.Indicator className="text-bg">
        {checked === 'indeterminate' ? <Minus className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

// --- Pill -------------------------------------------------------------------

const tones = {
  neutral: 'bg-surface-2 text-ink-2',
  accent: 'bg-accent-soft text-accent',
  positive: 'bg-positive-soft text-positive',
  negative: 'bg-negative-soft text-negative',
  warning: 'bg-warning-soft text-warning',
};

export function Pill({ tone = 'neutral', children, className }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-xs font-medium', tones[tone], className)}>
      {children}
    </span>
  );
}

// --- Segmented control ------------------------------------------------------

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
  size?: 'sm' | 'md';
}) {
  const id = useId();
  return (
    <div role="tablist" className={cn('inline-flex shrink-0 rounded-lg bg-surface-2 p-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative rounded-md px-2.5 font-medium transition-colors',
              size === 'sm' ? 'h-7 text-xs' : 'h-8 text-[13px]',
              active ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-md bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.08)] dark:bg-surface-3"
                transition={{ type: 'spring', bounce: 0.15, duration: 0.35 }}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// --- Skeleton / empty -------------------------------------------------------

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('rounded-md bg-surface-2', className)} />;
}

export function Empty({ title, children, action, className }: { title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <p className="mt-1 max-w-sm text-[13px] text-ink-3">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-surface px-1 font-sans text-[11px] font-medium text-ink-3">
      {children}
    </kbd>
  );
}

// --- Switch -----------------------------------------------------------------

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50',
        checked ? 'bg-positive' : 'bg-surface-3',
      )}
    >
      <span
        className={cn(
          'inline-block size-[14px] rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.2)] transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
          checked ? 'translate-x-[14px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}
