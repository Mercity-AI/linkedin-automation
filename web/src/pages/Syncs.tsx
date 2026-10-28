import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PullButton } from '@/components/dialogs';
import { AutoPullControls, describeSchedule, nextRunText } from '@/components/schedule';
import { PageBody, PageHeader } from '@/components/Layout';
import { Tooltip } from '@/components/ui/menu';
import { Avatar, Empty, Pill, Skeleton } from '@/components/ui/misc';
import { Spinner } from '@/components/ui/spinner';
import type { SyncRun } from '@/lib/api';
import { useMe, useSettings, useSyncs } from '@/lib/queries';
import { cn, displayName, fmtDateTime, fmtDuration, fmtNumber, fmtRange, fmtWhen, plural } from '@/lib/utils';

function StatusPill({ run }: { run: SyncRun }) {
  if (run.status === 'running')
    return (
      <Pill tone="accent">
        <Spinner className="size-3" /> Running · {fmtDuration(run.createdAt, null)}
      </Pill>
    );
  if (run.status === 'failed') return <Pill tone="negative">Failed</Pill>;
  return <Pill tone="positive">Done</Pill>;
}

function RunRow({ run }: { run: SyncRun }) {
  const [open, setOpen] = useState(false);
  const who =
    run.contacts.length === 1
      ? displayName(run.contacts[0])
      : `${run.contacts
          .slice(0, 2)
          .map((c) => (c.name ?? c.slug).split(' ')[0])
          .join(', ')}${run.contactCount > 2 ? ` +${run.contactCount - 2}` : ''}`;
  const notes = run.contacts.filter((c) => c.note).length;

  return (
    <li className="border-b border-line last:border-0">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-4 px-5 py-3 text-left transition-colors hover:bg-surface-2/50" aria-expanded={open}>
        <ChevronRight className={cn('size-4 shrink-0 text-ink-3 transition-transform duration-200', open && 'rotate-90')} />
        <div className="flex -space-x-1.5">
          {run.contacts.slice(0, 3).map((c) => (
            <Avatar key={c.id} src={c.avatarUrl} name={c.name ?? c.slug} size="sm" className="ring-2 ring-surface" />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">
            {run.kind === 'profile' ? 'Profile refresh' : 'Posts'} · {who}
          </div>
          <div className="truncate text-xs text-ink-3">
            <Tooltip content={fmtDateTime(run.createdAt)}>
              <span>{fmtWhen(run.createdAt)}</span>
            </Tooltip>
            {` · ${run.requestedBy ?? 'Automatic'}`}
            {run.kind === 'posts' && ` · ${fmtRange(run.startDate, run.endDate)}`}
            {run.finishedAt && ` · took ${fmtDuration(run.createdAt, run.finishedAt)}`}
          </div>
        </div>
        <div className="hidden w-28 text-right text-[13px] tabular sm:block">
          {run.kind === 'posts' && run.status === 'ready' && (
            <>
              <span className="font-medium">{fmtNumber(run.records)}</span> <span className="text-ink-3">found</span>
            </>
          )}
        </div>
        <div className="hidden w-24 text-right text-[13px] tabular sm:block">
          {run.kind === 'posts' && run.status === 'ready' && (run.newPosts ? <span className="text-positive">+{fmtNumber(run.newPosts)} new</span> : <span className="text-ink-4">0 new</span>)}
        </div>
        <div className="w-36 text-right">
          <StatusPill run={run} />
        </div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="pb-3 pl-14 pr-5">
              {run.error && <p className="mb-2 text-[13px] text-negative">{run.error}</p>}
              <ul className="rounded-xl bg-bg-subtle">
                {run.contacts.map((c) => (
                  <li key={c.id} className="flex items-start gap-3 border-b border-line px-3 py-2 last:border-0">
                    <Avatar src={c.avatarUrl} name={c.name ?? c.slug} size="xs" className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <Link to={`/people/${c.id}`} className="text-[13px] font-medium hover:underline">
                        {displayName(c)}
                      </Link>
                      {c.note && <p className="text-xs leading-relaxed text-ink-3">{c.note}</p>}
                    </div>
                    {run.kind === 'posts' && run.status === 'ready' && (
                      <span className="shrink-0 text-xs tabular text-ink-2">
                        {fmtNumber(c.records)} found{c.newPosts ? ` · +${c.newPosts} new` : ''}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-4">Snapshot {run.snapshotId}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {!open && notes > 0 && run.contactCount === 1 && <p className="-mt-1.5 pb-3 pl-[88px] pr-5 text-xs text-ink-3">{run.contacts[0].note}</p>}
    </li>
  );
}

function AutoPullSetting() {
  const { data: me } = useMe();
  const { data } = useSettings();
  const auto = data?.autoPull;
  if (!auto) return null;
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-5 py-4">
      <div className="min-w-0 max-w-xl">
        <h2 className="text-sm font-semibold">Automatic pulls</h2>
        <p className="mt-0.5 text-[13px] leading-relaxed text-ink-3">
          {auto.hours
            ? `Pulls everyone the pull rules cover ${describeSchedule(auto)}. Next run ${nextRunText(auto)}.`
            : 'Off. Turn it on to pull everyone the rules cover on a schedule.'}
        </p>
      </div>
      {me?.role === 'admin' ? (
        <AutoPullControls auto={auto} wide />
      ) : (
        <span className="text-[13px] text-ink-2">{auto.hours ? 'On' : 'Off'}</span>
      )}
    </div>
  );
}

export function SyncsPage() {
  const { data: runs, isLoading } = useSyncs();
  const running = (runs ?? []).filter((r) => r.status === 'running').length;
  return (
    <PageBody className="max-w-[1000px]">
      <PageHeader
        title="Pulls"
        actions={<PullButton />}
        sub={
          runs
            ? running
              ? `${plural(running, 'pull')} running now. Bright Data usually takes 1–3 minutes per pull.`
              : `${plural(runs.length, 'pull')} so far. Every request to Bright Data is listed here.`
            : 'Loading…'
        }
      />
      <AutoPullSetting />
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        {isLoading ? (
          <div className="space-y-4 p-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : runs?.length ? (
          <ul>
            {runs.map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </ul>
        ) : (
          <Empty title="No pulls yet">When you pull posts or add people, each request shows up here with what it found.</Empty>
        )}
      </div>
    </PageBody>
  );
}
