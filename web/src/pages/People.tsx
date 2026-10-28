import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowUp, ArrowUpRight, DownloadCloud, MoreHorizontal, Plus, Trash2, UserPlus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { CONNECTION_OPTIONS, ConnectionLabel, DisqualifiedPill, PERSONA_OPTIONS, PULL_REASON, PullPill, TIER_OPTIONS, TierBadge } from '@/components/crm';
import { AddPeopleDialog, OwnerSelect, PullButton, PullPostsDialog } from '@/components/dialogs';
import { removeCopy } from './Person';
import { SearchInput, useOwnerOptions, useParamState } from '@/components/filters';
import { PageBody, PageHeader } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Select, Tooltip } from '@/components/ui/menu';
import { Avatar, Checkbox, Empty, Skeleton } from '@/components/ui/misc';
import { Spinner } from '@/components/ui/spinner';
import { api, type Contact } from '@/lib/api';
import { invalidateData, useActiveSyncs, useAssign, useContacts, useTeam } from '@/lib/queries';
import { cn, displayName, fmtDateTime, fmtNumber, fmtWhen, plural } from '@/lib/utils';

type SortKey = 'name' | 'company' | 'connection' | 'owner' | 'open' | 'lastPost';

const TIER_RANK: Record<string, number> = { A: 0, B: 1, C: 2 };
const CONNECTION_RANK: Record<string, number> = { Connected: 0, 'Request Sent': 1 };

const sorters: Record<SortKey, (a: Contact, b: Contact) => number> = {
  name: (a, b) => displayName(a).localeCompare(displayName(b)),
  // Ascending = tier A first, then company name.
  company: (a, b) =>
    (TIER_RANK[a.account?.tier ?? ''] ?? 9) - (TIER_RANK[b.account?.tier ?? ''] ?? 9) ||
    (a.company ?? '~').localeCompare(b.company ?? '~'),
  connection: (a, b) => (CONNECTION_RANK[a.connection ?? ''] ?? 9) - (CONNECTION_RANK[b.connection ?? ''] ?? 9),
  owner: (a, b) => (a.owner?.name ?? '~').localeCompare(b.owner?.name ?? '~'),
  open: (a, b) => a.stats.open - b.stats.open,
  lastPost: (a, b) => (a.stats.lastPostAt ?? '').localeCompare(b.stats.lastPostAt ?? ''),
};
const ASCENDING_FIRST: SortKey[] = ['name', 'company', 'connection', 'owner'];

function SortHead({
  label,
  k,
  sort,
  setSort,
  className,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  setSort: (s: { key: SortKey; dir: 1 | -1 }) => void;
  className?: string;
}) {
  const active = sort.key === k;
  return (
    <th className={cn('h-10 px-3 font-normal', className)}>
      <button
        onClick={() => setSort({ key: k, dir: active ? ((sort.dir * -1) as 1 | -1) : ASCENDING_FIRST.includes(k) ? 1 : -1 })}
        className={cn('inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-ink', active && 'text-ink')}
      >
        {label}
        {active && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  );
}

export function PeoplePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useParamState('q', '');
  const [owner, setOwner] = useParamState('owner', 'all');
  const [tier, setTier] = useParamState('tier', 'all');
  const [persona, setPersona] = useParamState('persona', 'all');
  const [connection, setConnection] = useParamState('connection', 'all');
  const [status, setStatus] = useParamState('status', 'all');
  const ownerOptions = useOwnerOptions();
  const all = (v: string) => (v === 'all' ? undefined : v);
  const { data, isLoading } = useContacts({
    q: q || undefined,
    owner: all(owner),
    tier: all(tier),
    persona: all(persona),
    connection: all(connection),
    qualification: status === 'Qualified' || status === 'Disqualified' ? status : undefined,
    pulled: status === 'pulled' ? 'yes' : status === 'notpulled' ? 'no' : undefined,
  });
  const filtered = !!(q || owner !== 'all' || tier !== 'all' || persona !== 'all' || connection !== 'all' || status !== 'all');
  const { data: team } = useTeam();
  const { data: active } = useActiveSyncs();
  const assign = useAssign();

  const runningIds = useMemo(() => new Set((active ?? []).filter((a) => a.kind === 'posts').flatMap((a) => a.contactIds)), [active]);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'lastPost', dir: -1 });
  const rows = useMemo(() => [...(data ?? [])].sort((a, b) => sorters[sort.key](a, b) * sort.dir), [data, sort]);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const visibleSelected = rows.filter((r) => selected.has(r.id));
  const allChecked = rows.length > 0 && visibleSelected.length === rows.length;
  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const [addOpen, setAddOpen] = useState(false);
  const [pull, setPull] = useState<{ ids: number[]; label: string } | null>(null);

  const totals = useMemo(
    () => ({
      companies: new Set((data ?? []).map((c) => c.account?.id ?? c.company).filter(Boolean)).size,
      unassigned: (data ?? []).filter((c) => !c.owner).length,
      recent: (data ?? []).reduce((n, c) => n + c.stats.recent, 0),
    }),
    [data],
  );

  async function remove(c: Contact) {
    await api.del(`/contacts/${c.id}`);
    invalidateData(qc);
    setSelected((s) => (s.delete(c.id), new Set(s)));
    toast.success(`Removed ${displayName(c)}`);
  }

  return (
    <PageBody>
      <PageHeader
        title="People"
        sub={
          data
            ? [
                `${plural(data.length, 'person', 'people')}${totals.companies ? ` at ${plural(totals.companies, 'company', 'companies')}` : ''}`,
                `${fmtNumber(totals.recent)} posts in the last 30 days`,
                totals.unassigned ? `${fmtNumber(totals.unassigned)} unassigned` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : 'Loading…'
        }
        actions={
          <>
            <PullButton />
            <Button variant="primary" onClick={() => setAddOpen(true)}>
              <Plus /> Add people
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Search name, role or company" className="w-full sm:w-64" />
        <Select size="sm" value={owner} onValueChange={setOwner} options={ownerOptions} ariaLabel="Owner" prefix="Owner" />
        <Select size="sm" value={tier} onValueChange={setTier} options={TIER_OPTIONS} ariaLabel="Tier" />
        <Select size="sm" value={persona} onValueChange={setPersona} options={PERSONA_OPTIONS} ariaLabel="Persona" />
        <Select size="sm" value={connection} onValueChange={setConnection} options={CONNECTION_OPTIONS} ariaLabel="LinkedIn connection" />
        <Select
          size="sm"
          value={status}
          onValueChange={setStatus}
          ariaLabel="Status"
          options={[
            { value: 'all', label: 'Any status' },
            { value: 'Qualified', label: 'Qualified' },
            { value: 'Disqualified', label: 'Disqualified' },
            { value: 'pulled', label: 'Pulled' },
            { value: 'notpulled', label: 'Not pulled' },
          ]}
        />
        {filtered && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate('/people', { replace: true })}
            className="text-ink-3"
          >
            Clear
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        {isLoading ? (
          <div className="divide-y divide-line">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex h-[60px] items-center gap-3 px-4">
                <Skeleton className="size-9 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-36" />
                  <Skeleton className="h-3 w-56" />
                </div>
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          filtered ? (
            <Empty title="No one matches" action={<Button onClick={() => navigate('/people', { replace: true })}>Clear filters</Button>}>
              Try a different search, owner, tier or persona.
            </Empty>
          ) : (
            <Empty
              title="Track your first people"
              action={
                <Button variant="primary" onClick={() => setAddOpen(true)}>
                  <UserPlus /> Add people
                </Button>
              }
            >
              Paste LinkedIn profile links. Pulse fetches their profile and their latest posts and reposts.
            </Empty>
          )
        ) : (
          <>
            {/* Desktop table. lg: 44 + person + 172 + 96 + 76. xl adds company 200, LinkedIn 128, last post 100. */}
            <table className="hidden w-full table-fixed text-[13px] md:table">
              <colgroup>
                <col className="w-11" />
                <col />
                <col className="hidden w-[200px] xl:table-column" />
                <col className="hidden w-[128px] xl:table-column" />
                <col className="w-[172px]" />
                <col className="w-[96px]" />
                <col className="hidden w-[100px] xl:table-column" />
                <col className="w-[76px]" />
              </colgroup>
              <thead className="border-b border-line text-left text-ink-3">
                <tr>
                  <th className="pl-4">
                    <Checkbox
                      aria-label="Select all"
                      checked={allChecked ? true : visibleSelected.length ? 'indeterminate' : false}
                      onCheckedChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())}
                    />
                  </th>
                  <SortHead label="Person" k="name" sort={sort} setSort={setSort} />
                  <SortHead label="Company" k="company" sort={sort} setSort={setSort} className="hidden xl:table-cell" />
                  <SortHead label="LinkedIn" k="connection" sort={sort} setSort={setSort} className="hidden xl:table-cell" />
                  <SortHead label="Owner" k="owner" sort={sort} setSort={setSort} className="pl-5" />
                  <SortHead label="Needs reply" k="open" sort={sort} setSort={setSort} className="text-right" />
                  <SortHead label="Last post" k="lastPost" sort={sort} setSort={setSort} className="hidden xl:table-cell" />
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const pulling = runningIds.has(c.id) || c.syncing.posts;
                  const role = c.role ?? c.headline;
                  const disqualified = c.qualification === 'Disqualified';
                  return (
                    <tr
                      key={c.id}
                      onClick={() => navigate(`/people/${c.id}`)}
                      className={cn(
                        'group h-[60px] cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-surface-2/50',
                        selected.has(c.id) && 'bg-accent-soft/40 hover:bg-accent-soft/60',
                      )}
                    >
                      <td className="pl-4" onClick={(e) => e.stopPropagation()}>
                        <Checkbox aria-label={`Select ${displayName(c)}`} checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                      </td>
                      <td className="px-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar src={c.avatarUrl} name={c.name ?? c.slug} className={cn(disqualified && 'opacity-50')} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={cn('truncate text-sm font-medium', disqualified ? 'text-ink-3' : 'text-ink')}>{displayName(c)}</span>
                              <DisqualifiedPill value={c.qualification} />
                              {/* The Disqualified pill already says why. */}
                              {c.pull.reason !== 'disqualified' && <PullPill pull={c.pull} />}
                              {c.syncing.profile && !c.name && <Spinner className="size-3 text-ink-3" />}
                            </div>
                            <div className="truncate text-ink-3">
                              {pulling ? (
                                <span className="inline-flex items-center gap-1 text-accent">
                                  <Spinner className="size-3" /> Pulling posts
                                </span>
                              ) : (
                                <>
                                  {role ?? (c.syncing.profile ? 'Fetching profile…' : `linkedin.com/in/${c.slug}`)}
                                  {/* Company has its own column from xl up. */}
                                  {c.company && <span className="xl:hidden"> · {c.company}</span>}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="hidden px-3 xl:table-cell">
                        {c.company ? (
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-ink">{c.company}</span>
                              <TierBadge tier={c.account?.tier} />
                            </div>
                            <div className="truncate text-ink-3">{c.persona ?? c.account?.industry ?? ''}</div>
                          </div>
                        ) : (
                          <span className="text-ink-4">—</span>
                        )}
                      </td>
                      <td className="hidden px-3 xl:table-cell">
                        <ConnectionLabel value={c.connection} />
                      </td>
                      <td className="pl-3 pr-3" onClick={(e) => e.stopPropagation()}>
                        <OwnerSelect
                          value={c.owner && !c.owner.viaCompany ? c.owner.id : null}
                          inherited={c.account?.owner ?? null}
                          onChange={(ownerId) => assign.mutate({ ids: [c.id], ownerId })}
                          className="w-full max-w-[168px]"
                        />
                      </td>
                      <td className="px-3 text-right tabular">
                        {c.stats.open ? <span className="font-medium text-ink">{fmtNumber(c.stats.open)}</span> : <span className="text-ink-4">0</span>}
                      </td>
                      <td className="hidden px-3 text-ink-2 xl:table-cell">
                        <Tooltip content={c.stats.lastPostAt ? fmtDateTime(c.stats.lastPostAt) : undefined}>
                          <span>
                            {c.stats.lastPostAt ? fmtWhen(c.stats.lastPostAt) : <span className="text-ink-4">{c.postsSyncedAt ? 'None' : 'Not pulled'}</span>}
                          </span>
                        </Tooltip>
                      </td>
                      <td className="pr-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
                          <Tooltip content={c.pull.eligible ? 'Pull posts now' : PULL_REASON[c.pull.reason]}>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Pull posts"
                              disabled={pulling || !c.pull.eligible}
                              onClick={() => setPull({ ids: [c.id], label: displayName(c) })}
                            >
                              <DownloadCloud />
                            </Button>
                          </Tooltip>
                          <RowMenu contact={c} onRemove={() => remove(c)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Phone: two-line rows */}
            <ul className="divide-y divide-line md:hidden">
              {rows.map((c) => (
                <li key={c.id}>
                  <Link to={`/people/${c.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-surface-2">
                    <Avatar src={c.avatarUrl} name={c.name ?? c.slug} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{displayName(c)}</span>
                        <TierBadge tier={c.account?.tier} />
                      </div>
                      <div className="truncate text-xs text-ink-3">
                        {[c.role ?? c.headline, c.company].filter(Boolean).join(' · ') || `linkedin.com/in/${c.slug}`}
                      </div>
                      <div className="truncate text-xs text-ink-3">{c.owner?.name ?? 'Unassigned'}</div>
                    </div>
                    {c.stats.open > 0 && <span className="text-xs font-medium tabular">{c.stats.open}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* Bulk actions */}
      <AnimatePresence>
        {visibleSelected.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 12, x: '-50%' }}
            transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
            className="fixed bottom-6 left-1/2 z-30 flex items-center gap-1 rounded-xl border border-line bg-surface p-1.5 pl-3.5 shadow-pop lg:ml-[98px]"
          >
            <span className="mr-2 text-[13px] font-medium tabular">{visibleSelected.length} selected</span>
            <Button
              size="sm"
              disabled={!visibleSelected.some((c) => c.pull.eligible)}
              onClick={() => {
                const ids = visibleSelected.filter((c) => c.pull.eligible).map((c) => c.id);
                setPull({ ids, label: plural(ids.length, 'person', 'people') });
              }}
            >
              <DownloadCloud /> Pull posts
            </Button>
            <Menu>
              <MenuTrigger asChild>
                <Button size="sm">
                  <UserPlus /> Assign
                </Button>
              </MenuTrigger>
              <MenuContent align="center" side="top">
                {(team ?? [])
                  .filter((u) => u.active)
                  .map((u) => (
                    <MenuItem
                      key={u.id}
                      onSelect={() =>
                        assign.mutate(
                          { ids: visibleSelected.map((c) => c.id), ownerId: u.id },
                          {
                            onSuccess: () => {
                              toast.success(`Assigned ${plural(visibleSelected.length, 'person', 'people')} to ${u.name}`);
                              setSelected(new Set());
                            },
                          },
                        )
                      }
                    >
                      <Avatar name={u.name} size="xs" /> {u.name}
                    </MenuItem>
                  ))}
                <MenuSeparator />
                <MenuItem onSelect={() => assign.mutate({ ids: visibleSelected.map((c) => c.id), ownerId: null })}>
                  <X /> Unassign
                </MenuItem>
              </MenuContent>
            </Menu>
            <Button size="icon-sm" variant="ghost" aria-label="Clear selection" onClick={() => setSelected(new Set())} className="ml-1">
              <X />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <AddPeopleDialog open={addOpen} onOpenChange={setAddOpen} />
      <PullPostsDialog open={!!pull} onOpenChange={(v) => !v && setPull(null)} contactIds={pull?.ids ?? []} label={pull?.label ?? ''} />
    </PageBody>
  );
}

function RowMenu({ contact, onRemove }: { contact: Contact; onRemove: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <>
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="More">
          <MoreHorizontal />
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem onSelect={() => window.open(contact.url, '_blank', 'noreferrer')}>
          <ArrowUpRight /> Open LinkedIn profile
        </MenuItem>
        {contact.notionUrl && (
          <MenuItem onSelect={() => window.open(contact.notionUrl!, '_blank', 'noreferrer')}>
            <ArrowUpRight /> Open in Notion
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem danger onSelect={() => setConfirm(true)}>
          <Trash2 /> Remove
        </MenuItem>
      </MenuContent>
    </Menu>
    <ConfirmDialog
      open={confirm}
      onOpenChange={setConfirm}
      title={`Remove ${displayName(contact)}?`}
      description={removeCopy(contact.stats.total)}
      confirmLabel="Remove"
      onConfirm={onRemove}
    />
    </>
  );
}
