import { format } from 'date-fns';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { cn, fmtNumber } from '@/lib/utils';

/** Round the axis top up to a friendly step so there are 3–5 ticks. */
function niceScale(max: number) {
  if (max <= 4) return { top: 4, step: 1 };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => Math.max(1, m * mag)).find((s) => s >= raw)!; // counts: whole-number steps
  return { top: Math.ceil(max / step) * step, step };
}

const H = 200;
const PAD_L = 28;
const PAD_B = 22;

export function ActivityChart({ data, className }: { data: { date: string; value: number }[]; className?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...data.map((d) => d.value));
  const { top, step } = niceScale(max);
  const ticks = useMemo(() => Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step), [top, step]);
  const n = data.length;
  const W = 640;
  const plotW = W - PAD_L;
  const plotH = H - PAD_B;
  const slot = plotW / n;
  const barW = Math.max(4, slot * 0.62);
  const y = (v: number) => plotH - (v / top) * plotH;
  const labelEvery = Math.ceil(n / 6);
  const hovered = hover != null ? data[hover] : null;

  return (
    <div className={cn('relative', className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-[200px] w-full overflow-visible" preserveAspectRatio="none" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={W} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-line-strong' : 'stroke-line'} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        {data.map((d, i) => {
          const x = PAD_L + i * slot + (slot - barW) / 2;
          const h = Math.max(d.value ? 2 : 0, plotH - y(d.value));
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)}>
              <rect x={PAD_L + i * slot} y={0} width={slot} height={plotH} fill="transparent" />
              <motion.rect
                x={x}
                width={barW}
                rx={2}
                initial={false}
                animate={{ y: plotH - h, height: h }}
                transition={{ type: 'spring', bounce: 0, duration: 0.45, delay: i * 0.006 }}
                className={cn('transition-colors', hover === null || hover === i ? 'fill-accent' : 'fill-accent/35')}
              />
            </g>
          );
        })}
      </svg>
      {/* Axis labels live in HTML so they don't stretch with the SVG. */}
      <div className="pointer-events-none absolute inset-0">
        {ticks.map((t) => (
          <span key={t} className="absolute left-0 -translate-y-1/2 text-[11px] text-ink-3 tabular" style={{ top: `${(y(t) / H) * 100}%` }}>
            {t}
          </span>
        ))}
        {data.map((d, i) =>
          i % labelEvery === 0 ? (
            <span
              key={d.date}
              className="absolute bottom-0 -translate-x-1/2 text-[11px] text-ink-3"
              style={{ left: `${((PAD_L + i * slot + slot / 2) / W) * 100}%` }}
            >
              {format(new Date(`${d.date}T00:00:00`), 'MMM d')}
            </span>
          ) : null,
        )}
        {hovered && hover != null && (
          <div
            className="absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs text-bg shadow-pop"
            style={{ left: `${((PAD_L + hover * slot + slot / 2) / W) * 100}%`, top: `${(Math.min(y(hovered.value), plotH - 4) / H) * 100}%`, marginTop: -6 }}
          >
            <span className="font-medium tabular">{fmtNumber(hovered.value)}</span>
            <span className="text-bg/70"> · {format(new Date(`${hovered.date}T00:00:00`), 'EEE, MMM d')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
