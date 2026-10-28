import { Select } from '@/components/ui/menu';
import { useSetAutoPull, type AutoPull } from '@/lib/queries';
import { cn } from '@/lib/utils';

/** Automatic pulls run on a grid lined up with a time of day in India (IST, UTC+5:30). Mirrors server/src/sync.ts. */

const FREQUENCY = [
  { value: '0', label: 'Only manually' },
  { value: '6', label: 'Every 6 hours' },
  { value: '12', label: 'Every 12 hours' },
  { value: '24', label: 'Once a day' },
  { value: '48', label: 'Every 2 days' },
];

const pad = (n: number) => String(n).padStart(2, '0');

/** "21:30" → "9:30 PM" */
export function fmtClock(at: string) {
  const [h, m] = at.split(':').map(Number);
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
}

const TIMES = Array.from({ length: 48 }, (_, i) => {
  const value = `${pad(Math.floor(i / 2))}:${i % 2 ? '30' : '00'}`;
  return { value, label: fmtClock(value) };
});

/** Every time of day a schedule runs at, earliest first. */
function runTimes(hours: number, at: string) {
  const [h, m] = at.split(':').map(Number);
  if (hours >= 24) return [at];
  return Array.from({ length: 24 / hours }, (_, i) => `${pad((h + i * hours) % 24)}:${pad(m)}`).sort();
}

const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** "every day at 9:00 AM IST", "every day at 3:00 AM, 9:00 AM, 3:00 PM and 9:00 PM IST" */
export function describeSchedule({ hours, at }: Pick<AutoPull, 'hours' | 'at'>) {
  if (!hours) return 'only when someone starts a pull';
  return `${hours === 48 ? 'every other day' : 'every day'} at ${list(runTimes(hours, at).map(fmtClock))} IST`;
}

/** A moment, in IST words: "today at 9:00 PM IST", "tomorrow at 9:00 AM IST", "Fri, Oct 31 at 9:00 AM IST". */
export function fmtIst(iso: string) {
  const day = (t: number) => new Date(t + 330 * 60_000).toISOString().slice(0, 10);
  const t = Date.parse(iso);
  const at = fmtClock(new Date(t + 330 * 60_000).toISOString().slice(11, 16));
  const d = day(t);
  if (d === day(Date.now())) return `today at ${at} IST`;
  if (d === day(Date.now() + 864e5)) return `tomorrow at ${at} IST`;
  const label = new Date(t).toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short', month: 'short', day: 'numeric' });
  return `${label} at ${at} IST`;
}

/** When the next automatic pull runs, as a sentence fragment. */
export function nextRunText(auto: AutoPull) {
  if (!auto.hours || !auto.nextAt) return null;
  return Date.parse(auto.nextAt) > Date.now() ? fmtIst(auto.nextAt) : 'within a minute';
}

/** How often, and at what IST time. Admins only. */
export function AutoPullControls({ auto, className, wide }: { auto: AutoPull; className?: string; wide?: boolean }) {
  const set = useSetAutoPull();
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Select
        size="sm"
        value={String(auto.hours)}
        onValueChange={(v) => set.mutate({ hours: Number(v) })}
        ariaLabel="How often automatic pulls run"
        className={wide ? 'w-40' : 'min-w-0 flex-1'}
        options={FREQUENCY}
      />
      {auto.hours > 0 && (
        <Select
          size="sm"
          value={auto.at}
          onValueChange={(at) => set.mutate({ at })}
          ariaLabel="Time of day for automatic pulls, in IST"
          prefix="at"
          className={wide ? 'w-[150px]' : 'min-w-0 flex-1'}
          options={TIMES.map((t) => ({ ...t, label: `${t.label} IST` }))}
        />
      )}
    </div>
  );
}
