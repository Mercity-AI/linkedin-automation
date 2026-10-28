import { Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMe, useTeam } from '@/lib/queries';
import { cn } from '@/lib/utils';
import type { SelectOption } from './ui/menu';

/** URL-backed filter state, so views are linkable and survive reloads. */
export function useParamState<T extends string = string>(key: string, fallback: NoInfer<T>): [T, (v: T) => void] {
  const [params, setParams] = useSearchParams();
  const value = (params.get(key) as T) ?? fallback;
  const set = (v: T) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (v === fallback || v === '') next.delete(key);
        else next.set(key, v);
        return next;
      },
      { replace: true },
    );
  return [value, set];
}

export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  const [local, setLocal] = useState(value);
  const debounced = useDebounced(local);
  useEffect(() => {
    if (debounced !== value) onChange(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  useEffect(() => setLocal(value), [value]);
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
      <input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setLocal('')}
        placeholder={placeholder}
        className="h-8 w-full rounded-lg border border-line-strong bg-surface pl-8 pr-7 text-[13px] text-ink placeholder:text-ink-4 transition-[border-color,box-shadow] focus:border-accent focus:outline-none focus:ring-3 focus:ring-[var(--ring)]"
      />
      {local && (
        <button
          onClick={() => setLocal('')}
          className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-ink-3 hover:bg-surface-2 hover:text-ink"
          aria-label="Clear search"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** "Everyone / Mine / Unassigned / each teammate" */
export function useOwnerOptions(): SelectOption[] {
  const { data: team } = useTeam();
  const { data: me } = useMe();
  return [
    { value: 'all', label: 'Everyone' },
    { value: 'me', label: 'Assigned to me' },
    { value: 'unassigned', label: 'Unassigned' },
    ...(team ?? []).filter((u) => u.active && u.id !== me?.id).map((u) => ({ value: String(u.id), label: u.name })),
  ];
}
