import { ArrowUpRight, PenLine } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ActivityChart } from '@/components/ActivityChart';
import { PullButton } from '@/components/dialogs';
import { ReplyComposer } from '@/components/touches';
import { PageBody, PageHeader } from '@/components/Layout';
import { Button, buttonVariants } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/menu';
import { Avatar, Empty, Segmented, Skeleton } from '@/components/ui/misc';
import type { Post } from '@/lib/api';
import { useContacts, useMe, useOverview } from '@/lib/queries';
import { cn, displayName, fmtDateTime, fmtNumber, fmtWhen, fmtWhenInline, plural } from '@/lib/utils';

function Kpi({ label, value, sub, big, loading }: { label: string; value: string; sub?: React.ReactNode; big?: boolean; loading?: boolean }) {
  return (
    <div className="px-5 py-4">
      <div className="text-[13px] text-ink-3">{label}</div>
      {loading ? (
        <Skeleton className={cn('mt-2', big ? 'h-8 w-14' : 'h-6 w-12')} />
      ) : (
        <div className={cn('mt-1 font-semibold tracking-[-0.02em] tabular', big ? 'text-[32px] leading-[40px]' : 'text-2xl leading-8')}>{value}</div>
      )}
      {sub && <div className="mt-0.5 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

function Delta({ now, prev, since }: { now: number; prev: number; since: string | null }) {
  if (!since) return <span className="text-ink-4">—</span>;
  if (Date.now() - Date.parse(since) < 14 * 864e5) return <span>Comparison starts after 2 weeks of pulls</span>;
  if (!prev && !now) return <span>No change vs prior 7 days</span>;
  if (!prev) return <span>+{now} (new) vs prior 7 days</span>;
  const d = now - prev;
  if (!d) return <span>Same as prior 7 days</span>;
  const pct = Math.round((d / prev) * 100);
  return (
    <span>
      <span className={d > 0 ? 'text-positive' : 'text-ink-2'}>
        {d > 0 ? '+' : '−'}
        {Math.abs(pct)}%
      </span>{' '}
      vs prior 7 days
    </span>
  );
}

function QueueRow({ post }: { post: Post }) {
  const [logging, setLogging] = useState(false);
  const who = post.contact.name ?? post.contact.slug;
  const snippet = post.article?.title ?? post.text ?? post.original?.text ?? post.title ?? '';
  return (
    <li className="group flex items-start gap-3 px-5 py-3.5">
      <Link to={`/people/${post.contact.id}`}>
        <Avatar src={post.contact.avatarUrl} name={who} size="md" />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[13px]">
          <Link to={`/people/${post.contact.id}`} className="truncate font-medium hover:underline">
            {who}
          </Link>
          <span className="shrink-0 text-ink-3">
            {post.article ? 'shared an article' : post.kind === 'post' ? 'posted' : 'reposted'} · {fmtWhen(post.postedAt)}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-ink-2">{snippet}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1 pt-0.5">
        <Tooltip content={post.draft ? 'Edit your reply' : 'Write a reply'}>
          <Button size="icon-sm" variant="ghost" aria-label="Write reply" onClick={() => setLogging(true)}>
            <PenLine />
          </Button>
        </Tooltip>
        <a href={post.url} target="_blank" rel="noreferrer" className={buttonVariants({ size: 'sm' })}>
          Reply <ArrowUpRight />
        </a>
      </div>
      <ReplyComposer post={logging ? post : null} onOpenChange={(v) => !v && setLogging(false)} />
    </li>
  );
}

export function OverviewPage() {
  const { data: me } = useMe();
  const { data, isLoading } = useOverview();
  const { data: everyone } = useContacts({});
  const [series, setSeries] = useState<'all' | 'posts' | 'reposts'>('all');

  const chart = useMemo(
    () =>
      (data?.activity ?? []).map((d) => ({
        date: d.date,
        value: series === 'posts' ? d.posts : series === 'reposts' ? d.reposts : d.posts + d.reposts,
      })),
    [data, series],
  );
  const chartTotal = chart.reduce((n, d) => n + d.value, 0);
  const k = data?.kpis;
  const firstName = me?.name.split(' ')[0];

  return (
    <PageBody>
      <PageHeader
        title="Overview"
        sub={
          k
            ? k.openMine
              ? `${firstName}, ${plural(k.openMine, 'post')} from your people need a reply.`
              : k.mine
                ? `You’re all caught up, ${firstName}.`
                : 'No one is assigned to you yet.'
            : ' '
        }
        actions={
          <>
            {data?.lastSyncAt && (
              <Tooltip content={fmtDateTime(data.lastSyncAt)}>
                <span className="text-[13px] text-ink-3">Last pull {fmtWhenInline(data.lastSyncAt)}</span>
              </Tooltip>
            )}
            {!!everyone?.length && <PullButton />}
          </>
        }
      />

      {/* KPI strip: one divided container */}
      <div className="grid grid-cols-2 divide-line overflow-hidden rounded-2xl border border-line bg-surface [&>*]:border-line max-md:[&>*:nth-child(n+3)]:border-t md:grid-cols-4 md:divide-x [&>*:nth-child(2n)]:border-l md:[&>*:nth-child(2n)]:border-l-0">
        <Kpi big label="Needs your reply" value={fmtNumber(k?.openMine)} loading={isLoading} sub={k && `${fmtNumber(k.openAll)} across the team`} />
        <Kpi label="Posts this week" value={fmtNumber(k?.week)} loading={isLoading} sub={k && <Delta now={k.week} prev={k.prevWeek} since={data?.trackingSince ?? null} />} />
        <Kpi
          label="People tracked"
          value={fmtNumber(k?.people)}
          loading={isLoading}
          sub={k && `${fmtNumber(k.mine)} yours · ${fmtNumber(k.unassigned)} unassigned`}
        />
        <Kpi label="Replied this week" value={fmtNumber(k?.handledWeek)} loading={isLoading} sub="By the whole team" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-line bg-surface p-5">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Activity</h2>
              <p className="text-[13px] text-ink-3">
                {fmtNumber(chartTotal)} {series === 'all' ? 'posts and reposts' : series} in the last 30 days
              </p>
            </div>
            <Segmented
              size="sm"
              value={series}
              onChange={setSeries}
              options={[
                { value: 'all', label: 'All' },
                { value: 'posts', label: 'Posts' },
                { value: 'reposts', label: 'Reposts' },
              ]}
            />
          </div>
          {isLoading ? <Skeleton className="h-[200px] w-full" /> : <ActivityChart data={chart} />}
        </section>

        <section className="rounded-2xl border border-line bg-surface">
          <div className="flex items-baseline justify-between px-5 pb-2 pt-5">
            <h2 className="text-sm font-semibold">Most active</h2>
            <span className="text-[13px] text-ink-3">30 days</span>
          </div>
          {data && data.active.length === 0 ? (
            <p className="px-5 pb-5 text-[13px] text-ink-3">No posts in the last 30 days yet.</p>
          ) : (
            <ul className="pb-2">
              {(data?.active ?? []).map((p) => (
                <li key={p.id}>
                  <Link to={`/people/${p.id}`} className="flex items-center gap-3 px-5 py-2 transition-colors hover:bg-surface-2/60">
                    <Avatar src={p.avatarUrl} name={p.name ?? p.slug} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{displayName(p)}</div>
                      <div className="truncate text-xs text-ink-3">{p.owner ? p.owner.name : 'Unassigned'}</div>
                    </div>
                    <span className="text-[13px] tabular text-ink-2">{p.posts}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="mt-6 rounded-2xl border border-line bg-surface">
        <div className="flex items-baseline justify-between px-5 pb-1 pt-5">
          <div>
            <h2 className="text-sm font-semibold">Your queue</h2>
            <p className="text-[13px] text-ink-3">Newest posts from people assigned to you that still need a reply.</p>
          </div>
          {!!k?.openMine && (
            <Link to="/feed?owner=me&status=open" className="shrink-0 text-[13px] font-medium text-accent hover:underline">
              View all {fmtNumber(k.openMine)}
            </Link>
          )}
        </div>
        {isLoading ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : data?.queue.length ? (
          <ul className="divide-y divide-line">
            {data.queue.map((p) => (
              <QueueRow key={p.id} post={p} />
            ))}
          </ul>
        ) : (
          <Empty
            title={k?.mine ? 'Inbox zero' : 'Nothing assigned to you'}
            action={
              !k?.mine && (
                <Link to="/people" className={buttonVariants({})}>
                  Go to People
                </Link>
              )
            }
          >
            {k?.mine
              ? 'Every post from your people has been handled. New ones show up here after the next pull.'
              : 'Assign yourself people on the People page and their new posts will queue up here.'}
          </Empty>
        )}
      </section>

    </PageBody>
  );
}
