import { AnimatePresence, motion } from 'motion/react';
import { Check, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { DisqualifiedPill, PULL_MODE_LABEL, PULL_MODE_OPTIONS, TierBadge } from '@/components/crm';
import { AutoPullControls, describeSchedule, nextRunText } from '@/components/schedule';
import { OwnerSelect } from '@/components/dialogs';
import { SearchInput, useParamState } from '@/components/filters';
import { PageBody, PageHeader } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Select, Tooltip } from '@/components/ui/menu';
import { Skeleton, Segmented, Switch } from '@/components/ui/misc';
import { Spinner } from '@/components/ui/spinner';
import type { BrainEntry, NotionSyncResult, PullMode, PullReason, PullRules } from '@/lib/api';
import { useBrain, useBrainMutation, useCompanies, useNotion, useNotionSync, usePullSummary, useSetNotionHours, useSetPullRules, useSettings, useSyncs, useUpdateCompany } from '@/lib/queries';
import { cn, fmtDateTime, fmtNumber, fmtWhenInline, plural } from '@/lib/utils';

const STARTERS: { title: string; hint: string }[] = [
  { title: 'About Mercity', hint: 'Who we are and what we’re known for, in a few lines.' },
  { title: 'What we offer', hint: 'The services and products we lead with, and the problems they solve.' },
  { title: 'Who we sell to', hint: 'Ideal companies and roles. Why they buy from us.' },
  { title: 'Voice and tone', hint: 'How our replies should sound. Examples of good comments.' },
  { title: 'Talking points', hint: 'Opinions and research we like to bring into conversations.' },
  { title: 'Things to avoid', hint: 'Topics, claims or phrasing we never use.' },
];

// --- Knowledge entries -------------------------------------------------------------

function EntryCard({ entry }: { entry: BrainEntry }) {
  const { update, remove } = useBrainMutation();
  const [title, setTitle] = useState(entry.title);
  const [body, setBody] = useState(entry.body);
  const [saved, setSaved] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setTitle(entry.title), [entry.title]);
  useEffect(() => setBody(entry.body), [entry.body]);
  useEffect(() => {
    // New, empty entries open ready to type.
    if (!entry.body && Date.now() - Date.parse(entry.updatedAt) < 5000) bodyRef.current?.focus();
  }, [entry.body, entry.updatedAt]);

  async function save() {
    const changes: { title?: string; body?: string } = {};
    if (title.trim() && title.trim() !== entry.title) changes.title = title.trim();
    if (body !== entry.body) changes.body = body;
    if (!Object.keys(changes).length) return setTitle(entry.title);
    await update.mutateAsync({ id: entry.id, ...changes });
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  const hint = STARTERS.find((s) => s.title === entry.title)?.hint ?? 'Write it the way you’d brief a new teammate.';
  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="group rounded-2xl border border-line bg-surface px-5 pb-3 pt-4 transition-colors focus-within:border-line-strong"
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-label="Entry title"
        className="w-full bg-transparent text-[15px] font-semibold tracking-[-0.01em] text-ink outline-none placeholder:text-ink-4"
      />
      <textarea
        ref={bodyRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onBlur={save}
        placeholder={hint}
        aria-label={`${entry.title} notes`}
        style={{ fieldSizing: 'content' } as React.CSSProperties}
        className="mt-1.5 min-h-[72px] w-full resize-none bg-transparent text-sm leading-[1.65] text-ink-2 outline-none placeholder:text-ink-4"
      />
      <footer className="mt-1 flex items-center gap-2 text-xs text-ink-3">
        <Tooltip content={fmtDateTime(entry.updatedAt)}>
          <span>
            Edited {fmtWhenInline(entry.updatedAt)}
            {entry.updatedBy && ` by ${entry.updatedBy}`}
          </span>
        </Tooltip>
        <AnimatePresence>
          {(update.isPending || saved) && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="inline-flex items-center gap-1">
              {update.isPending ? <Spinner className="size-3" /> : <Check className="size-3 text-positive" />}
              {update.isPending ? 'Saving' : 'Saved'}
            </motion.span>
          )}
        </AnimatePresence>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${entry.title}`}
          onClick={() => setConfirm(true)}
          className="ml-auto opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
        >
          <Trash2 />
        </Button>
      </footer>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete “${entry.title}”?`}
        description="This removes it from the Brain for everyone."
        confirmLabel="Delete"
        onConfirm={() => remove.mutateAsync(entry.id)}
      />
    </motion.article>
  );
}

function Knowledge() {
  const { data: entries, isLoading } = useBrain();
  const { create } = useBrainMutation();
  const used = new Set((entries ?? []).map((e) => e.title));
  const starters = STARTERS.filter((s) => !used.has(s.title));

  return (
    <section className="min-w-0">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Knowledge</h2>
          <p className="text-[13px] text-ink-3">Who we are, what we offer and how we sound. Reply drafting will draw on this.</p>
        </div>
        <Button size="sm" onClick={() => create.mutate({ title: 'Untitled' })} loading={create.isPending}>
          <Plus /> New entry
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-32 w-full rounded-2xl" />
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {(entries ?? []).map((e) => (
              <EntryCard key={e.id} entry={e} />
            ))}
          </AnimatePresence>
          {starters.length > 0 && (
            <div className={cn('rounded-2xl border border-dashed border-line-strong px-5 py-5', entries?.length && 'py-4')}>
              {!entries?.length && (
                <>
                  <p className="text-sm font-medium">Teach Pulse about Mercity</p>
                  <p className="mt-0.5 text-[13px] text-ink-3">Start with one of these, or write your own entry.</p>
                </>
              )}
              <div className={cn('flex flex-wrap gap-1.5', !entries?.length && 'mt-3')}>
                {starters.map((s) => (
                  <button
                    key={s.title}
                    onClick={() => create.mutate({ title: s.title })}
                    disabled={create.isPending}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    <Plus className="size-3.5 text-ink-3" /> {s.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// --- Automations ---------------------------------------------------------------------

function syncSummary(r: NotionSyncResult) {
  if (!r.ok) return r.error ?? 'Sync failed.';
  const p = r.pulled;
  const sent = r.pushed?.activitiesCreated ?? 0;
  const parts = [
    p && `${fmtNumber(p.people.added + p.people.updated)} people, ${fmtNumber(p.accounts.added + p.accounts.updated)} companies, ${fmtNumber(p.activities.added + p.activities.updated)} touches read`,
    p?.people.added ? `${plural(p.people.added, 'new person', 'new people')}` : null,
    sent ? `${plural(sent, 'touch', 'touches')} sent to Notion` : null,
    r.pushed?.contactsUpdated ? `${plural(r.pushed.contactsUpdated, 'contact')} updated in Notion` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface">
      <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">{title}</h2>
      <div className="space-y-3 px-4 py-3.5 text-[13px]">{children}</div>
    </section>
  );
}

function NotionPanel() {
  const { data } = useNotion();
  const sync = useNotionSync();
  const setHours = useSetNotionHours();
  const status = data?.status;
  const conn = data?.connection;
  const running = sync.isPending || status?.running;

  return (
    <Panel title="Notion sync">
      {!data ? (
        <Skeleton className="h-20 w-full" />
      ) : !conn?.configured ? (
        <p className="text-ink-2">Add NOTION_TOKEN and NOTION_ABM_PAGE_ID to the server’s .env to connect the ABM CRM.</p>
      ) : (
        <>
          <div className="flex items-start gap-2">
            <span className={cn('mt-[7px] size-1.5 shrink-0 rounded-full', conn.ok ? 'bg-positive' : 'bg-negative')} />
            <p className="text-ink-2">
              {conn.ok ? (
                <>
                  Connected to the <span className="font-medium text-ink">ABM CRM</span> as {conn.name}
                  {conn.workspace && ` in ${conn.workspace}`}.
                </>
              ) : (
                <span className="text-negative">{conn.error}</span>
              )}
            </p>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-ink-2">Runs</span>
            <Select
              size="sm"
              value={String(status?.hours ?? 12)}
              onValueChange={(v) => setHours.mutate(Number(v))}
              ariaLabel="Notion sync schedule"
              className="w-40"
              options={[
                { value: '6', label: 'Every 6 hours' },
                { value: '12', label: 'Every 12 hours' },
                { value: '24', label: 'Once a day' },
                { value: '0', label: 'Only manually' },
              ]}
            />
          </div>

          <div className="rounded-lg bg-surface-2/70 px-3 py-2.5">
            {running ? (
              <span className="inline-flex items-center gap-1.5 text-accent">
                <Spinner className="size-3.5" /> Syncing with Notion…
              </span>
            ) : status?.last ? (
              <>
                <div className="flex items-center gap-1.5 font-medium">
                  {status.last.ok ? <Check className="size-3.5 text-positive" /> : <span className="size-1.5 rounded-full bg-negative" />}
                  <Tooltip content={fmtDateTime(status.last.finishedAt)}>
                    <span>Last synced {fmtWhenInline(status.last.finishedAt)}</span>
                  </Tooltip>
                  <span className="font-normal text-ink-3">· {status.last.by ?? 'automatic'}</span>
                </div>
                <p className={cn('mt-0.5 leading-relaxed', status.last.ok ? 'text-ink-3' : 'text-negative')}>{syncSummary(status.last)}</p>
              </>
            ) : (
              <span className="text-ink-3">Not synced yet.</span>
            )}
          </div>

          {!!status?.pendingActivities && (
            <p className="text-ink-2">
              {plural(status.pendingActivities, 'touch', 'touches')} waiting to go to Notion
              {status.last?.pushed?.activitiesWaiting ? ' (some are for people who aren’t in the Notion CRM)' : ''}.
            </p>
          )}

          <Button size="sm" onClick={() => sync.mutate()} loading={!!running} disabled={!conn.ok} className="w-full">
            {!running && <RefreshCw />} Sync now
          </Button>
          <p className="leading-relaxed text-ink-3">
            Touches reach Notion within a minute. New people, companies and activities come in on every sync.
          </p>
        </>
      )}
    </Panel>
  );
}

function PullsPanel() {
  const { data } = useSettings();
  const { data: runs } = useSyncs();
  const auto = data?.autoPull;
  const last = runs?.find((r) => r.kind === 'posts');
  return (
    <Panel title="Automatic post pulls">
      {auto ? <AutoPullControls auto={auto} /> : <Skeleton className="h-8 w-full" />}

      <div className="rounded-lg bg-surface-2/70 px-3 py-2.5">
        {!runs ? (
          <Skeleton className="h-9 w-full" />
        ) : !last ? (
          <span className="text-ink-3">No pulls yet.</span>
        ) : last.status === 'running' ? (
          <span className="inline-flex items-center gap-1.5 text-accent">
            <Spinner className="size-3.5" /> Pulling posts for {plural(last.contactCount, 'person', 'people')}…
          </span>
        ) : (
          <>
            <div className="flex items-center gap-1.5 font-medium">
              {last.status === 'ready' ? <Check className="size-3.5 text-positive" /> : <span className="size-1.5 rounded-full bg-negative" />}
              <Tooltip content={fmtDateTime(last.finishedAt ?? last.createdAt)}>
                <span>
                  {last.status === 'ready' ? 'Last pull' : 'Last pull failed'} {fmtWhenInline(last.finishedAt ?? last.createdAt)}
                </span>
              </Tooltip>
              <span className="font-normal text-ink-3">· {last.requestedBy ?? 'automatic'}</span>
            </div>
            <p className={cn('mt-0.5 leading-relaxed', last.status === 'ready' ? 'text-ink-3' : 'text-negative')}>
              {last.status === 'ready'
                ? `${plural(last.contactCount, 'person', 'people')}, ${plural(last.newPosts, 'new post')}.`
                : (last.error ?? 'Bright Data didn’t return results.')}
            </p>
          </>
        )}
      </div>

      <p className="leading-relaxed text-ink-3">
        {auto?.hours ? `Pulls everyone the rules cover ${describeSchedule(auto)}. Next run ${nextRunText(auto)}.` : 'Off. Pull by hand from People or Pulls.'}
      </p>
    </Panel>
  );
}

// --- Pull rules ------------------------------------------------------------------------

const EXCLUDED_LABEL: Partial<Record<PullReason, string>> = {
  'company-disqualified': 'at disqualified companies',
  disqualified: 'marked disqualified',
  'no-owner': 'at companies nobody is assigned to',
  tier: 'at companies outside the chosen tiers',
  'company-never': 'at companies set to Never',
};

function RuleRow({ title, hint, checked, onChange, id }: { title: string; hint: string; checked: boolean; onChange: (v: boolean) => void; id: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <label htmlFor={id} className="cursor-pointer">
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-ink-3">{hint}</span>
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}

function PullRulesTab() {
  const { data: summary } = usePullSummary();
  const setRules = useSetPullRules();
  const { data: companies } = useCompanies();
  const updateCompany = useUpdateCompany();
  const [q, setQ] = useState('');
  const rules = summary?.rules;
  const save = (patch: Partial<PullRules>) => rules && setRules.mutate({ ...rules, ...patch });
  const toggleTier = (t: string) => rules && save({ tiers: rules.tiers.includes(t) ? rules.tiers.filter((x) => x !== t) : [...rules.tiers, t] });

  const shown = (companies ?? []).filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.owner?.name.toLowerCase().includes(q.toLowerCase()));
  const pct = summary && summary.total ? Math.round((summary.eligible / summary.total) * 100) : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Panel title="Who gets pulled">
          {!summary || !rules ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <div>
                <div className="text-2xl font-semibold tracking-[-0.02em] tabular">
                  {fmtNumber(summary.eligible)} <span className="text-base font-normal text-ink-3">of {fmtNumber(summary.total)} people</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <motion.div className="h-full rounded-full bg-accent" initial={false} animate={{ width: `${pct}%` }} transition={{ duration: 0.4 }} />
                </div>
                {Object.entries(summary.excluded).length > 0 && (
                  <p className="mt-2 leading-relaxed text-ink-3">
                    Left out:{' '}
                    {Object.entries(summary.excluded)
                      .map(([reason, n]) => `${n} ${EXCLUDED_LABEL[reason as PullReason] ?? reason}`)
                      .join(', ')}
                    .
                  </p>
                )}
              </div>
              <div className="-my-1 divide-y divide-line border-t border-line">
                <RuleRow
                  id="rule-disq"
                  title="Include disqualified"
                  hint="Off: skips companies and people Notion marks Disqualified."
                  checked={rules.includeDisqualified}
                  onChange={(v) => save({ includeDisqualified: v })}
                />
                <RuleRow
                  id="rule-owned"
                  title="Only companies with someone assigned"
                  hint="Skips companies nobody on the team is assigned to. Assign them in the table."
                  checked={rules.onlyOwnedCompanies}
                  onChange={(v) => save({ onlyOwnedCompanies: v })}
                />
                <div className="py-3">
                  <span className="block text-[13px] font-medium">Company tiers</span>
                  <span className="mt-0.5 block text-xs text-ink-3">Pull people at companies in these tiers.</span>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {[
                      ['A', 'Tier A'],
                      ['B', 'Tier B'],
                      ['C', 'Tier C'],
                      ['none', 'No tier'],
                    ].map(([t, label]) => {
                      const on = rules.tiers.includes(t);
                      return (
                        <button
                          key={t}
                          onClick={() => toggleTier(t)}
                          aria-pressed={on}
                          className={cn(
                            'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors',
                            on ? 'border-ink bg-ink text-bg' : 'border-line-strong text-ink-3 hover:text-ink',
                          )}
                        >
                          {on && <Check className="size-3" />} {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <p className="leading-relaxed text-ink-3">
                Companies set to <span className="font-medium text-ink-2">Always</span> or{' '}
                <span className="font-medium text-ink-2">Never</span> ignore these rules.
              </p>
            </>
          )}
        </Panel>

      </aside>

      <section className="min-w-0">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Companies</h2>
            <p className="text-[13px] text-ink-3">Whoever is assigned to a company replies to everyone there. Always or Never overrides the rules for the whole company.</p>
          </div>
          <SearchInput value={q} onChange={setQ} placeholder="Search companies or owners" className="w-full sm:w-60" />
        </div>
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <table className="w-full table-fixed text-[13px]">
            <colgroup>
              <col />
              <col className="w-[92px]" />
              <col className="w-[180px]" />
              <col className="w-[156px]" />
            </colgroup>
            <thead className="border-b border-line text-left text-ink-3">
              <tr className="h-10">
                <th className="px-4 font-normal">Company</th>
                <th className="px-3 text-right font-normal">Pulled</th>
                <th className="px-3 font-normal">Assigned to</th>
                <th className="px-3 font-normal">Pulls</th>
              </tr>
            </thead>
            <tbody>
              {!companies
                ? [0, 1, 2, 3].map((i) => (
                    <tr key={i} className="h-[52px] border-b border-line last:border-0">
                      <td className="px-4" colSpan={4}>
                        <Skeleton className="h-4 w-48" />
                      </td>
                    </tr>
                  ))
                : shown.map((co) => (
                    <tr key={co.id} className="h-[52px] border-b border-line last:border-0">
                      <td className="px-4">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <Link to={`/people?q=${encodeURIComponent(co.name)}`} className="truncate font-medium hover:underline">
                            {co.name}
                          </Link>
                          <TierBadge tier={co.tier} />
                          <DisqualifiedPill value={co.stage} />
                        </div>
                        <div className="truncate text-xs text-ink-3">{[co.industry, co.size && `${co.size} people`].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="px-3 text-right tabular">
                        <span className={co.pulled ? 'text-ink' : 'text-ink-4'}>{co.pulled}</span>
                        <span className="text-ink-3"> of {co.people}</span>
                      </td>
                      <td className="px-2">
                        <OwnerSelect
                          value={co.owner?.id ?? null}
                          onChange={(ownerId) => updateCompany.mutate({ id: co.id, ownerId }, { onSuccess: () => toast.success(ownerId ? `Assigned ${co.name}` : `Unassigned ${co.name}`) })}
                          className="w-full"
                        />
                      </td>
                      <td className="px-2">
                        <Select
                          size="sm"
                          value={co.pullMode}
                          onValueChange={(v) =>
                            updateCompany.mutate({ id: co.id, pullMode: v as PullMode }, { onSuccess: () => toast.success(`${co.name}: ${PULL_MODE_LABEL[v as PullMode]}`) })
                          }
                          ariaLabel={`Pulls for ${co.name}`}
                          className={cn('w-full border-transparent bg-transparent hover:border-line-strong hover:bg-surface', co.pullMode !== 'auto' && 'font-medium')}
                          options={PULL_MODE_OPTIONS}
                        />
                      </td>
                    </tr>
                  ))}
              {companies && !shown.length && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-ink-3">
                    No companies match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function BrainPage() {
  const [tab, setTab] = useParamState<'knowledge' | 'pulls' | 'sync'>('tab', 'knowledge');
  return (
    <PageBody className="max-w-[1180px]">
      <PageHeader
        title="Brain"
        sub="What Pulse knows about Mercity, who it pulls, and what it runs on its own. Only admins can see this page."
        actions={
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'knowledge', label: 'Knowledge' },
              { value: 'pulls', label: 'Pull rules' },
              { value: 'sync', label: 'Sync & schedule' },
            ]}
          />
        }
      />
      {tab === 'knowledge' && (
        <div className="max-w-[780px]">
          <Knowledge />
        </div>
      )}
      {tab === 'pulls' && <PullRulesTab />}
      {tab === 'sync' && (
        <div className="grid items-start gap-4 md:grid-cols-2">
          <NotionPanel />
          <PullsPanel />
        </div>
      )}
    </PageBody>
  );
}
