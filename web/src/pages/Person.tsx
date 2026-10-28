import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowUpRight, Check, CircleSlash, DownloadCloud, MoreHorizontal, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ConnectionLabel, DisqualifiedPill, PULL_MODE_LABEL, PULL_REASON, TierBadge } from '@/components/crm';
import { ActivityTimeline, LogTouchDialog } from '@/components/touches';
import { OwnerSelect, PullPostsDialog } from '@/components/dialogs';
import { useParamState } from '@/components/filters';
import { PageBody } from '@/components/Layout';
import { PostCard, PostCardSkeleton } from '@/components/PostCard';
import { Button, buttonVariants } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tooltip } from '@/components/ui/menu';
import { Avatar, Empty, Pill, Segmented, Skeleton } from '@/components/ui/misc';
import { Spinner } from '@/components/ui/spinner';
import { api, type Account, type Colleague, type PullMode, type SyncHistoryItem } from '@/lib/api';
import { invalidateData, keys, useActiveSyncs, useAssign, useContact, useMe, usePosts, useUpdateCompany } from '@/lib/queries';
import { cn, displayName, fmtCompact, fmtDateTime, fmtNumber, fmtRange, fmtWhen, plural } from '@/lib/utils';

function Notes({ id, initial }: { id: number; initial: string | null }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(initial ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  useEffect(() => setValue(initial ?? ''), [initial]);
  async function save() {
    if ((initial ?? '') === value) return;
    setState('saving');
    try {
      await api.patch(`/contacts/${id}`, { notes: value || null });
      qc.invalidateQueries({ queryKey: keys.contact(id) });
      setState('saved');
      setTimeout(() => setState('idle'), 1800);
    } catch (e) {
      toast.error((e as Error).message);
      setState('idle');
    }
  }
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-[13px] font-medium text-ink-3">Notes</h3>
        <AnimatePresence>
          {state !== 'idle' && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="inline-flex items-center gap-1 text-xs text-ink-3">
              {state === 'saving' ? <Spinner className="size-3" /> : <Check className="size-3" />}
              {state === 'saving' ? 'Saving' : 'Saved'}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        placeholder="Context for whoever replies: how we know them, topics to bring up…"
        className="min-h-28 resize-y text-[13px]"
      />
    </div>
  );
}

function HistoryRow({ h }: { h: SyncHistoryItem }) {
  return (
    <li className="py-2.5">
      <div className="flex items-center justify-between gap-2 text-[13px]">
        <span className="font-medium">{h.kind === 'profile' ? 'Profile refresh' : fmtRange(h.startDate, h.endDate)}</span>
        {h.status === 'running' ? (
          <Pill tone="accent">
            <Spinner className="size-3" /> Running
          </Pill>
        ) : h.status === 'failed' ? (
          <Pill tone="negative">Failed</Pill>
        ) : h.kind === 'posts' ? (
          <span className="text-ink-2 tabular">
            {h.newPosts ? `+${fmtNumber(h.newPosts)} new` : `${fmtNumber(h.records)} found`}
          </span>
        ) : (
          <Check className="size-3.5 text-positive" />
        )}
      </div>
      <Tooltip content={fmtDateTime(h.createdAt)}>
        <p className="mt-0.5 w-fit text-xs text-ink-3">
          {fmtWhen(h.createdAt)}
          {` · ${h.requestedBy ?? 'Automatic'}`}
        </p>
      </Tooltip>
      {(h.note || h.error) && <p className="mt-1 text-xs leading-relaxed text-ink-2">{h.error ?? h.note}</p>}
    </li>
  );
}

/** Websites in the CRM are sometimes annotated ("https://alice.io (formerly activefence.com)"). */
function siteOf(raw: string | null) {
  const url = raw?.match(/https?:\/\/[^\s)]+/)?.[0];
  if (!url) return null;
  try {
    return { url, host: new URL(url).hostname.replace(/^www\./, '') };
  } catch {
    return null;
  }
}

function CompanyCard({ account, colleagues }: { account: Account; colleagues: Colleague[] }) {
  const site = siteOf(account.website);
  const [whyOpen, setWhyOpen] = useState(false);
  const facts = [
    ['Owner', account.owner?.name ?? 'Nobody yet'],
    ['Size', account.size ? `${account.size} people` : null],
    ['Industry', account.industry],
    ['Stage', account.stage],
    ['Pulls', account.pullMode === 'auto' ? null : PULL_MODE_LABEL[account.pullMode]],
  ].filter(([, v]) => v) as [string, string][];
  return (
    <section>
      <h3 className="mb-1.5 text-[13px] font-medium text-ink-3">Company</h3>
      <div className="overflow-hidden rounded-xl border border-line">
        <div className="flex items-start justify-between gap-3 px-3.5 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold">{account.name}</span>
              <TierBadge tier={account.tier} />
            </div>
            {site && (
              <a href={site.url} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
                {site.host}
              </a>
            )}
          </div>
          {account.notionUrl && (
            <Tooltip content="Open account in Notion">
              <a href={account.notionUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}>
                <ArrowUpRight />
              </a>
            </Tooltip>
          )}
        </div>
        {facts.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-line px-3.5 py-2.5 text-[13px]">
            {facts.map(([label, value]) => (
              <Fragment key={label}>
                <dt className="text-ink-3">{label}</dt>
                <dd className="truncate text-right text-ink-2">{value}</dd>
              </Fragment>
            ))}
          </dl>
        )}
        {account.whyNow && (
          <div className="border-t border-line px-3.5 py-2.5">
            <div className="text-xs font-medium text-ink-3">Why now</div>
            <p className={cn('mt-1 text-[13px] leading-relaxed text-ink-2', !whyOpen && 'line-clamp-4')}>{account.whyNow}</p>
            {account.whyNow.length > 180 && (
              <button onClick={() => setWhyOpen((o) => !o)} className="mt-1 text-xs font-medium text-ink-3 hover:text-ink">
                {whyOpen ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )}
        {colleagues.length > 0 && (
          <div className="border-t border-line py-1.5">
            <div className="px-3.5 pb-1 pt-1 text-xs font-medium text-ink-3">Also at {account.name}</div>
            {colleagues.map((p) => (
              <Link key={p.id} to={`/people/${p.id}`} className="flex items-center gap-2.5 px-3.5 py-1.5 transition-colors hover:bg-surface-2/60">
                <Avatar src={p.avatarUrl} name={p.name ?? p.slug} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{p.name ?? p.slug}</span>
                  <span className="block truncate text-xs text-ink-3">{[p.role, p.owner].filter(Boolean).join(' · ')}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export const removeCopy = (posts: number) =>
  posts
    ? `Their ${plural(posts, 'saved post')} and reply statuses will be deleted. You can add them again later.`
    : 'They’ll be removed from Pulse. You can add them again later.';

export function PersonPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading, error } = useContact(id);
  const { data: active } = useActiveSyncs();
  const assign = useAssign();
  const updateCompany = useUpdateCompany();
  const { data: me } = useMe();
  const [kind, setKind] = useParamState<'all' | 'post' | 'repost'>('kind', 'all');
  const [status, setStatus] = useParamState<'all' | 'open' | 'replied'>('status', 'all');
  const posts = usePosts({ contact: id, kind: kind === 'all' ? undefined : kind, status: status === 'all' ? undefined : status });
  const items = useMemo(() => posts.data?.pages.flatMap((p) => p.posts) ?? [], [posts.data]);
  const [pullOpen, setPullOpen] = useState(false);
  const [tab, setTab] = useParamState<'posts' | 'touches'>('tab', 'posts');
  const [touchOpen, setTouchOpen] = useState(false);
  // Switching tabs (e.g. "View timeline" from a toast) should land at the top of the person.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [tab]);
  const [removeOpen, setRemoveOpen] = useState(false);

  const pulling = (active ?? []).some((a) => a.kind === 'posts' && a.contactIds.includes(id));
  // Pulls only reach people their company's pull settings cover, even when started by hand.
  const blocked = !!data && !data.contact.pull.eligible;
  const c = data?.contact;

  if (error) {
    return (
      <PageBody>
        <Empty title="Person not found" action={<Link to="/people" className="text-accent hover:underline">Back to People</Link>}>
          They may have been removed.
        </Empty>
      </PageBody>
    );
  }

  return (
    <PageBody>
      <Link to="/people" className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-ink-3 transition-colors hover:text-ink">
        <ArrowLeft className="size-3.5" /> People
      </Link>

      {/* Identity */}
      <div className="mb-8 flex flex-wrap items-start gap-5">
        {isLoading || !c ? (
          <>
            <Skeleton className="size-[72px] rounded-full" />
            <div className="space-y-2 pt-2">
              <Skeleton className="h-6 w-56" />
              <Skeleton className="h-4 w-80" />
            </div>
          </>
        ) : (
          <>
            <Avatar src={c.avatarUrl} name={c.name ?? c.slug} size="xl" />
            <div className="min-w-0 flex-1 pt-1">
              <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em]">{displayName(c)}</h1>
              {(c.role ?? c.headline) && <p className="mt-1 max-w-2xl text-sm text-ink-2">{c.role ?? c.headline}</p>}
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[13px] text-ink-3">
                {/* Separator trails each item, so a wrapped line never starts with a dot. */}
                {[c.company, c.location, c.followers != null && `${fmtCompact(c.followers)} followers`]
                  .filter(Boolean)
                  .map((t, i, all) => (
                    <span key={i} className="inline-flex items-center gap-2">
                      {t}
                      {i < all.length - 1 && <span className="text-ink-4">·</span>}
                    </span>
                  ))}
              </p>
              {(c.account?.tier || c.persona || c.connection || c.campaign || c.qualification === 'Disqualified') && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {c.account?.tier && (
                    <Pill tone={c.account.tier === 'A' ? 'accent' : 'neutral'}>Tier {c.account.tier}</Pill>
                  )}
                  {c.persona && <Pill>{c.persona}</Pill>}
                  <Pill className="bg-transparent px-1">
                    <ConnectionLabel value={c.connection} className="text-xs" />
                  </Pill>
                  {c.campaign && <Pill className="bg-transparent px-1 font-normal text-ink-3">{c.campaign}</Pill>}
                  <DisqualifiedPill value={c.qualification} />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {c.notionUrl && (
                <a href={c.notionUrl} target="_blank" rel="noreferrer" className={buttonVariants({})}>
                  Notion <ArrowUpRight />
                </a>
              )}
              <a href={c.url} target="_blank" rel="noreferrer" className={buttonVariants({})}>
                LinkedIn <ArrowUpRight />
              </a>
              <Tooltip content={blocked ? `${PULL_REASON[c.pull.reason]}.` : undefined}>
                <span>
                  <Button variant="primary" onClick={() => setPullOpen(true)} disabled={pulling || blocked}>
                    {pulling ? <Spinner className="size-3.5" /> : blocked ? <CircleSlash /> : <DownloadCloud />}
                    {pulling ? 'Pulling…' : blocked ? 'Not pulled' : 'Pull posts'}
                  </Button>
                </span>
              </Tooltip>
              <Menu>
                <MenuTrigger asChild>
                  <Button size="icon" aria-label="More">
                    <MoreHorizontal />
                  </Button>
                </MenuTrigger>
                <MenuContent>
                  <MenuItem
                    disabled={c.syncing.profile}
                    onSelect={async () => {
                      await api.post(`/contacts/${id}/refresh-profile`);
                      qc.invalidateQueries({ queryKey: keys.active });
                      invalidateData(qc);
                      toast.success('Refreshing profile');
                    }}
                  >
                    <RefreshCw /> Refresh profile
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem danger onSelect={() => setRemoveOpen(true)}>
                    <Trash2 /> Remove
                  </MenuItem>
                </MenuContent>
              </Menu>
            </div>
          </>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* Posts */}
        <section className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: 'posts', label: <>Posts{posts.data ? <span className="ml-1.5 text-ink-3 tabular">{fmtNumber(posts.data.pages[0]?.total ?? 0)}</span> : null}</> },
                { value: 'touches', label: <>Touches{data ? <span className="ml-1.5 text-ink-3 tabular">{fmtNumber(data.activities.length)}</span> : null}</> },
              ]}
            />
            {tab === 'touches' ? (
              <Button size="sm" onClick={() => setTouchOpen(true)}>
                <Plus /> Log a touch
              </Button>
            ) : (
            <div className="flex flex-wrap gap-2">
              <Segmented
                size="sm"
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'post', label: 'Posts' },
                  { value: 'repost', label: 'Reposts' },
                ]}
              />
              <Segmented
                size="sm"
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'all', label: 'Any' },
                  { value: 'open', label: 'Needs reply' },
                  { value: 'replied', label: 'Replied' },
                ]}
              />
            </div>
            )}
          </div>

          {tab === 'touches' ? (
            data?.activities.length ? (
              <div className="rounded-2xl border border-line bg-surface px-5 py-5">
                <ActivityTimeline activities={data.activities} />
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-line-strong">
                <Empty
                  title="No touches yet"
                  action={
                    <Button onClick={() => setTouchOpen(true)}>
                      <Plus /> Log a touch
                    </Button>
                  }
                >
                  Replies you log from the feed land here, along with connection requests, messages and anything from Notion.
                </Empty>
              </div>
            )
          ) : (
          <>

          {posts.isLoading ? (
            <div className="space-y-4">
              <PostCardSkeleton />
              <PostCardSkeleton />
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line-strong">
              {pulling ? (
                <Empty title="Pulling posts…">Bright Data is reading their LinkedIn activity. This usually takes 1–3 minutes.</Empty>
              ) : kind !== 'all' || status !== 'all' ? (
                <Empty title="Nothing matches these filters" />
              ) : (
                <Empty
                  title={c?.postsSyncedAt ? 'No public posts found' : 'No posts pulled yet'}
                  action={
                    <Button variant="primary" onClick={() => setPullOpen(true)}>
                      <DownloadCloud /> Pull posts
                    </Button>
                  }
                >
                  {c?.postsSyncedAt ? data?.history.find((h) => h.kind === 'posts' && h.note)?.note ?? 'Their recent activity may be private.' : 'Pull their latest posts and reposts from LinkedIn.'}
                </Empty>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <AnimatePresence initial={false}>
                {items.map((p) => (
                  <motion.div key={p.id} layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <PostCard post={p} showPerson={false} />
                  </motion.div>
                ))}
              </AnimatePresence>
              {posts.hasNextPage && (
                <div className="flex justify-center pt-2">
                  <Button onClick={() => posts.fetchNextPage()} loading={posts.isFetchingNextPage}>
                    Show more
                  </Button>
                </div>
              )}
            </div>
          )}
          </>
          )}
        </section>

        {/* Side panel */}
        <aside className="space-y-7 lg:sticky lg:top-6 lg:self-start">
          {c && (
            <>
              <div>
                <h3 className="mb-1.5 text-[13px] font-medium text-ink-3">Owner</h3>
                <OwnerSelect
                  value={c.owner && !c.owner.viaCompany ? c.owner.id : null}
                  inherited={c.account?.owner ?? null}
                  onChange={(ownerId) => assign.mutate({ ids: [id], ownerId }, { onSuccess: () => toast.success('Owner updated') })}
                  size="md"
                  className="w-full border-line-strong bg-surface"
                />
                <p className="mt-1.5 text-xs text-ink-3">
                  {c.owner?.viaCompany ? `${c.owner.name} owns ${c.company ?? 'their company'}, so they reply here too.` : 'The owner replies to this person’s posts.'}
                </p>
              </div>

              <div>
                <h3 className="mb-1.5 text-[13px] font-medium text-ink-3">Post pulls</h3>
                <p className={cn('flex items-center gap-1.5 text-[13px]', c.pull.eligible ? 'text-ink-2' : 'text-ink-3')}>
                  <span className={cn('size-1.5 shrink-0 rounded-full', c.pull.eligible ? 'bg-positive' : 'bg-ink-4')} />
                  {PULL_REASON[c.pull.reason]}
                </p>
                {c.account && me?.role === 'admin' && (
                  <>
                    <Segmented
                      size="sm"
                      className="mt-2.5"
                      value={c.account.pullMode}
                      onChange={(pullMode: PullMode) =>
                        updateCompany.mutate(
                          { id: c.account!.id, pullMode },
                          { onSuccess: () => toast.success(`${c.account!.name}: ${PULL_MODE_LABEL[pullMode]}`) },
                        )
                      }
                      options={[
                        { value: 'auto', label: 'Follow rules' },
                        { value: 'always', label: 'Always' },
                        { value: 'never', label: 'Never' },
                      ]}
                    />
                    <p className="mt-1.5 text-xs text-ink-3">Set for everyone at {c.account.name}.</p>
                  </>
                )}
              </div>

              {c.account && <CompanyCard account={c.account} colleagues={data.colleagues} />}

              <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-line">
                {[
                  ['Posts, 30 days', fmtNumber(c.stats.recent)],
                  ['Needs reply', fmtNumber(c.stats.open)],
                  ['Saved posts', fmtNumber(c.stats.total)],
                  ['Of which reposts', c.stats.total ? `${Math.round((c.stats.reposts / c.stats.total) * 100)}%` : '—'],
                ].map(([label, value], i) => (
                  <div key={label} className={`px-3.5 py-3 ${i % 2 ? 'border-l border-line' : ''} ${i > 1 ? 'border-t border-line' : ''}`}>
                    <dt className="text-xs text-ink-3">{label}</dt>
                    <dd className="mt-0.5 text-lg font-medium tabular">{value}</dd>
                  </div>
                ))}
              </dl>

              <Notes id={id} initial={c.notes} />

              <div>
                <h3 className="text-[13px] font-medium text-ink-3">Pull history</h3>
                {data.history.length ? (
                  <ul className="divide-y divide-line">
                    {data.history.slice(0, 6).map((h) => (
                      <HistoryRow key={h.id} h={h} />
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[13px] text-ink-3">Never pulled.</p>
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      {c && (
        <>
          <PullPostsDialog open={pullOpen} onOpenChange={setPullOpen} contactIds={[id]} label={displayName(c)} />
          <LogTouchDialog contactId={id} name={displayName(c)} open={touchOpen} onOpenChange={setTouchOpen} />
          <ConfirmDialog
            open={removeOpen}
            onOpenChange={setRemoveOpen}
            title={`Remove ${displayName(c)}?`}
            description={removeCopy(c.stats.total)}
            confirmLabel="Remove"
            onConfirm={async () => {
              await api.del(`/contacts/${id}`);
              invalidateData(qc);
              toast.success(`Removed ${displayName(c)}`);
              navigate('/people');
            }}
          />
        </>
      )}
    </PageBody>
  );
}
