import * as Dropdown from '@radix-ui/react-dropdown-menu';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Check, ChevronDown } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

const popSurface = 'anim-pop z-50 rounded-xl border border-line bg-surface p-1 shadow-pop';
const item =
  'relative flex h-8 cursor-default select-none items-center gap-2 rounded-lg px-2.5 text-[13px] text-ink outline-none transition-colors data-[disabled]:pointer-events-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-ink-3';

// --- Dropdown ---------------------------------------------------------------

export const Menu = Dropdown.Root;
export const MenuTrigger = Dropdown.Trigger;

export function MenuContent({ className, align = 'end', ...props }: ComponentProps<typeof Dropdown.Content>) {
  return (
    <Dropdown.Portal>
      <Dropdown.Content sideOffset={6} align={align} className={cn(popSurface, 'min-w-48', className)} {...props} />
    </Dropdown.Portal>
  );
}

export function MenuItem({ className, danger, ...props }: ComponentProps<typeof Dropdown.Item> & { danger?: boolean }) {
  return <Dropdown.Item className={cn(item, danger && 'text-negative [&_svg]:text-negative', className)} {...props} />;
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof Dropdown.Label>) {
  return <Dropdown.Label className={cn('px-2.5 pb-1 pt-1.5 text-xs text-ink-3', className)} {...props} />;
}

export const MenuSeparator = () => <Dropdown.Separator className="-mx-1 my-1 h-px bg-line" />;

// --- Popover ----------------------------------------------------------------

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({ className, align = 'start', ...props }: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content sideOffset={6} align={align} className={cn(popSurface, 'p-3', className)} {...props} />
    </PopoverPrimitive.Portal>
  );
}

// --- Select -----------------------------------------------------------------

export interface SelectOption {
  value: string;
  label: ReactNode;
  hint?: ReactNode;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  size = 'md',
  prefix,
  ariaLabel,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  size?: 'sm' | 'md';
  prefix?: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 text-ink transition-colors hover:bg-surface-2 focus:outline-none focus-visible:ring-3 focus-visible:ring-[var(--ring)] data-[placeholder]:text-ink-3',
          size === 'sm' ? 'h-8 text-[13px]' : 'h-9 text-sm',
          className,
        )}
      >
        {prefix && <span className="text-ink-3">{prefix}</span>}
        <span className="min-w-0 flex-1 truncate text-left">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown className="size-3.5 text-ink-3" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" sideOffset={6} className={cn(popSurface, 'max-h-80 min-w-[var(--radix-select-trigger-width)]')}>
          <SelectPrimitive.Viewport>
            {options.map((o) => (
              <SelectPrimitive.Item key={o.value} value={o.value} className={cn(item, 'pr-8')}>
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                {o.hint && <span className="ml-auto pl-3 text-xs text-ink-3 tabular">{o.hint}</span>}
                <SelectPrimitive.ItemIndicator className="absolute right-2.5">
                  <Check className="!text-ink" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

// --- Tooltip ----------------------------------------------------------------

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  if (!content) return <>{children}</>;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="anim-pop z-50 max-w-72 rounded-md bg-ink px-2 py-1 text-xs leading-snug text-bg shadow-pop"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
