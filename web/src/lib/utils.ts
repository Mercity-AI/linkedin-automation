import { clsx, type ClassValue } from 'clsx';
import { differenceInCalendarDays, format, formatDistanceToNowStrict, isThisYear } from 'date-fns';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

const nf = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export const fmtNumber = (n: number | null | undefined) => (n == null ? '—' : nf.format(n));
export const fmtCompact = (n: number | null | undefined) => (n == null ? '—' : compact.format(n));

/** "4m", "3h", "Yesterday", "Oct 12", "Oct 12, 2024" */
export function fmtWhen(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  const days = differenceInCalendarDays(new Date(), d);
  if (days === 0) {
    const s = formatDistanceToNowStrict(d);
    return s.startsWith('0') || s.includes('second') ? 'Just now' : s.replace(/ minutes?/, 'm').replace(/ hours?/, 'h') + ' ago';
  }
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return format(d, isThisYear(d) ? 'MMM d' : 'MMM d, yyyy');
}

/** fmtWhen for mid-sentence use: "last post yesterday", but keeps "Sep 29" capitalized. */
export function fmtWhenInline(iso: string | null | undefined) {
  const w = fmtWhen(iso);
  return /^[A-Z][a-z]{2} \d/.test(w) ? w : w.toLowerCase();
}

export const fmtDateTime = (iso: string | null | undefined) => (iso ? format(new Date(iso), 'MMM d, yyyy · h:mm a') : '—');
export const fmtDay = (iso: string | null | undefined) => (iso ? format(new Date(iso), 'MMM d, yyyy') : '—');

export function fmtRange(start: string | null, end: string | null) {
  if (!start && !end) return 'Latest';
  const f = (s: string) => format(new Date(`${s}T00:00:00`), 'MMM d');
  if (start && end) return `${f(start)} – ${f(end)}`;
  return start ? `Since ${f(start)}` : `Until ${f(end!)}`;
}

export function fmtDuration(from: string, to: string | null) {
  const ms = (to ? Date.parse(to) : Date.now()) - Date.parse(from);
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

export const initials = (name: string | null | undefined, fallback = '?') =>
  (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || fallback;

export const displayName = (c: { name: string | null; slug: string }) => c.name ?? c.slug;

export const plural = (n: number, one: string, many = `${one}s`) => `${fmtNumber(n)} ${n === 1 ? one : many}`;

export const isoDay = (d: Date) => format(d, 'yyyy-MM-dd');

/** "agnes-heftberger-5a1b2c" -> "Agnes Heftberger", for authors we only know by profile slug. */
export function humanizeSlug(slug: string | null | undefined) {
  if (!slug) return null;
  const parts = slug.split('-').filter((p) => p && !/\d/.test(p));
  return parts.length ? parts.map((p) => p[0]!.toUpperCase() + p.slice(1)).join(' ') : slug;
}
