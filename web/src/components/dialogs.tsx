import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, DownloadCloud, Info, SlidersHorizontal, Sparkles, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { invalidateData, keys, useMe, usePullScope, usePullSummary, useStartSync, useTeam } from '@/lib/queries';
import { cn, isoDay, plural } from '@/lib/utils';
import { Button } from './ui/button';
import { Dialog, DialogContent } from './ui/dialog';
import { Field, Input, Label, Textarea } from './ui/input';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Select } from './ui/menu';
import { Avatar, Checkbox } from './ui/misc';

// --- Owner picker -----------------------------------------------------------

export function OwnerSelect({
  value,
  onChange,
  size = 'sm',
  className,
  includeUnassigned = true,
  inherited,
}: {
  value: number | null;
  onChange: (id: number | null) => void;
  size?: 'sm' | 'md';
  className?: string;
  includeUnassigned?: boolean;
  /** The company's owner, used when the person has none of their own. */
  inherited?: { name: string } | null;
}) {
  const { data: team } = useTeam();
  const { data: me } = useMe();
  const options = [
    ...(includeUnassigned
      ? [
          {
            value: 'none',
            label: inherited ? (
              <span className="inline-flex items-center gap-2">
                <Avatar name={inherited.name} size="xs" />
                {inherited.name}
                <span className="text-ink-3">via company</span>
              </span>
            ) : (
              <span className="text-ink-3">Unassigned</span>
            ),
          },
        ]
      : []),
    ...(team ?? [])
      .filter((u) => u.active || u.id === value)
      .map((u) => ({
        value: String(u.id),
        label: (
          <span className="inline-flex items-center gap-2">
            <Avatar name={u.name} size="xs" />
            {u.name}
            {u.id === me?.id && <span className="text-ink-3">(you)</span>}
          </span>
        ),
      })),
  ];
  return (
    <Select
      size={size}
      value={value ? String(value) : 'none'}
      onValueChange={(v) => onChange(v === 'none' ? null : Number(v))}
      options={options}
      ariaLabel="Owner"
      className={cn('border-transparent bg-transparent hover:border-line-strong hover:bg-surface', className)}
    />
  );
}

// --- Pull posts -------------------------------------------------------------

type Preset = 'latest' | '7' | '30' | 'custom';

export function PullPostsDialog({
  open,
  onOpenChange,
  contactIds = [],
  label,
  scope,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Hand-picked people… */
  contactIds?: number[];
  label: string;
  /** …or everyone the pull rules cover ('eligible') / only those never pulled ('new'). */
  scope?: 'eligible' | 'new';
}) {
  const sync = useStartSync();
  const scoped = usePullScope();
  const [preset, setPreset] = useState<Preset>('latest');
  const today = isoDay(new Date());
  const [start, setStart] = useState(isoDay(new Date(Date.now() - 30 * 864e5)));
  const [end, setEnd] = useState(today);
  useEffect(() => {
    if (open) setPreset('latest');
  }, [open]);

  const range = useMemo(() => {
    if (preset === 'latest') return {};
    if (preset === 'custom') return { start, end };
    return { start: isoDay(new Date(Date.now() - Number(preset) * 864e5)), end: today };
  }, [preset, start, end, today]);

  async function submit() {
    const res = scope ? await scoped.mutateAsync({ scope, ...range }) : await sync.mutateAsync({ ids: contactIds, ...range });
    if (scope && !res.runId && !res.skipped) {
      toast.message('Nobody to pull', { description: scope === 'new' ? 'Everyone the rules cover has been pulled before.' : 'The pull rules don’t cover anyone right now.' });
      onOpenChange(false);
      return;
    }
    const off = res.excluded ? `${plural(res.excluded, 'person', 'people')} outside the pull rules ${res.excluded === 1 ? 'was' : 'were'} skipped.` : '';
    if (res.runId)
      toast.success(`Pulling posts for ${label}`, { description: [off, 'This usually takes 1–3 minutes. You can keep working.'].filter(Boolean).join(' ') });
    else if (res.excluded && !res.skipped) toast.message('Nothing to pull', { description: 'The pull rules leave out everyone selected.' });
    else toast.message(`Already pulling ${label}`, { description: ['Wait for the current pull to finish.', off].filter(Boolean).join(' ') });
    onOpenChange(false);
  }

  const presets: { value: Preset; label: string; hint: string }[] = [
    { value: 'latest', label: 'Latest activity', hint: 'Recommended' },
    { value: '7', label: 'Last 7 days', hint: '' },
    { value: '30', label: 'Last 30 days', hint: '' },
    { value: 'custom', label: 'Custom range', hint: '' },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Pull posts"
        description={`Posts and reposts for ${label}.`}
        footer={
          <>
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" loading={sync.isPending || scoped.isPending} onClick={submit} disabled={preset === 'custom' && (!start || !end || start > end)}>
              Start pull
            </Button>
          </>
        }
      >
        <div className="space-y-1" role="radiogroup">
          {presets.map((p) => (
            <button
              key={p.value}
              role="radio"
              aria-checked={preset === p.value}
              onClick={() => setPreset(p.value)}
              className={cn(
                'flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors',
                preset === p.value ? 'bg-surface-2' : 'hover:bg-surface-2/60',
              )}
            >
              <span
                className={cn(
                  'grid size-4 place-items-center rounded-full border transition-colors',
                  preset === p.value ? 'border-ink bg-ink' : 'border-line-strong',
                )}
              >
                {preset === p.value && <span className="size-1.5 rounded-full bg-bg" />}
              </span>
              <span className="flex-1">{p.label}</span>
              {p.hint && <span className="text-xs text-ink-3">{p.hint}</span>}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="From" htmlFor="from">
              <Input id="from" type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="To" htmlFor="to">
              <Input id="to" type="date" value={end} min={start} max={today} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>
        )}
        <div className="mt-4 flex gap-2.5 rounded-lg bg-surface-2 px-3 py-2.5 text-[13px] leading-relaxed text-ink-2">
          <Info className="mt-0.5 size-4 shrink-0 text-ink-3" />
          <p>
            Each pull sees about the 10 newest posts and reposts on someone’s public LinkedIn activity, which is often just the last week
            for active posters. A date range only filters those; it can’t reach further back. Pulse keeps everything it has already seen, so
            pulling regularly builds the history.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Add people -------------------------------------------------------------

// Same rule as the server's extractProfileSlugs, so the count matches what gets added.
const PROFILE_RE = /linkedin\.com\/in\/([A-Za-z0-9\-_%.\u00C0-\uFFFF]+?)(?=https?:|[\s/?#,:;'"<>)]|$)/gi;

export function AddPeopleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [text, setText] = useState('');
  const [ownerId, setOwnerId] = useState<number | null>(null);
  const [pull, setPull] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setText('');
      setOwnerId(me?.role === 'admin' ? null : (me?.id ?? null));
      setPull(true);
    }
  }, [open, me]);

  const detected = useMemo(() => new Set([...text.matchAll(PROFILE_RE)].map((m) => m[1].toLowerCase())).size, [text]);

  async function submit() {
    setBusy(true);
    try {
      const res = await api.post<{ added: number[]; existing: number[]; invalid: string[]; errors: string[] }>('/contacts', {
        urls: text.split(/\n+/),
        ownerId,
        pullPosts: pull,
      });
      invalidateData(qc);
      qc.invalidateQueries({ queryKey: keys.active });
      const parts = [
        res.added.length && `Added ${plural(res.added.length, 'person', 'people')}`,
        res.existing.length && `${res.existing.length} already tracked`,
        res.invalid.length && `${res.invalid.length} skipped (not a profile link)`,
      ].filter(Boolean);
      if (res.errors.length) toast.error(res.errors[0]);
      toast.success(parts.join(' · ') || 'Nothing to add', {
        description: res.added.length ? (pull ? 'Fetching their profiles and latest posts.' : 'Fetching their profiles.') : undefined,
      });
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add people"
        description="Paste LinkedIn profile links, one per line."
        className="max-w-[540px]"
        footer={
          <>
            <span className="mr-auto text-[13px] text-ink-3 tabular">{detected ? plural(detected, 'profile') + ' detected' : ''}</span>
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!detected} onClick={submit}>
              Add {detected > 1 ? plural(detected, 'person', 'people') : 'person'}
            </Button>
          </>
        }
      >
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
          rows={6}
          placeholder={'https://www.linkedin.com/in/someone/\nhttps://www.linkedin.com/in/someone-else/'}
          className="resize-none text-[13px]"
        />
        <div className="mt-4 flex items-center justify-between gap-4">
          <Label className="mb-0">Assign to</Label>
          <OwnerSelect value={ownerId} onChange={setOwnerId} size="md" className="w-56 border-line-strong bg-surface" />
        </div>
        <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-sm">
          <Checkbox checked={pull} onCheckedChange={setPull} />
          Pull their latest posts right away
        </label>
      </DialogContent>
    </Dialog>
  );
}

// --- Pull button: everyone the rules cover, or only new people ------------------------

export function PullButton({ size = 'md', variant = 'secondary' }: { size?: 'sm' | 'md'; variant?: 'secondary' | 'primary' }) {
  const { data: summary } = usePullSummary();
  const { data: me } = useMe();
  const navigate = useNavigate();
  const [scope, setScope] = useState<'eligible' | 'new' | null>(null);
  const eligible = summary?.eligible ?? 0;
  const fresh = summary?.new ?? 0;
  return (
    <>
      <div className="inline-flex">
        <Button
          size={size}
          variant={variant}
          disabled={!eligible}
          onClick={() => setScope('eligible')}
          className="rounded-r-none border-r-0"
        >
          <DownloadCloud /> Pull posts{summary ? <span className="tabular opacity-60">· {eligible}</span> : null}
        </Button>
        <Menu>
          <MenuTrigger asChild>
            <Button size={size} variant={variant} aria-label="More pull options" className={cn('rounded-l-none px-2', variant === 'secondary' && 'border-l-line')}>
              <ChevronDown />
            </Button>
          </MenuTrigger>
          <MenuContent className="w-72">
            <MenuItem onSelect={() => setScope('eligible')} disabled={!eligible}>
              <Users />
              <span className="flex-1">Everyone the rules cover</span>
              <span className="tabular text-ink-3">{eligible}</span>
            </MenuItem>
            <MenuItem onSelect={() => setScope('new')} disabled={!fresh}>
              <Sparkles />
              <span className="flex-1">Only new people</span>
              <span className="tabular text-ink-3">{fresh}</span>
            </MenuItem>
            <p className="px-2.5 pb-1.5 pt-1 text-xs leading-relaxed text-ink-3">
              New people match the rules but have never been pulled.
              {summary && summary.total > eligible ? ` ${summary.total - eligible} people are left out by the rules.` : ''}
            </p>
            {me?.role === 'admin' && (
              <>
                <MenuSeparator />
                <MenuItem onSelect={() => navigate('/brain?tab=pulls')}>
                  <SlidersHorizontal /> Edit pull rules
                </MenuItem>
              </>
            )}
          </MenuContent>
        </Menu>
      </div>
      <PullPostsDialog
        open={!!scope}
        onOpenChange={(v) => !v && setScope(null)}
        scope={scope ?? 'eligible'}
        label={scope === 'new' ? plural(fresh, 'new person', 'new people') : `${plural(eligible, 'person', 'people')} the rules cover`}
      />
    </>
  );
}
