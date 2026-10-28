import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { Brain, Check, ChevronsUpDown, History, KeyRound, LayoutGrid, ListTodo, LogOut, Menu as MenuIcon, Monitor, Moon, Newspaper, Search, Sun, UserCog, Users } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { api, type SyncRun, type User } from '@/lib/api';
import { invalidateData, keys, useActiveSyncs, useLogout, useOverview } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import { cn, plural } from '@/lib/utils';
import { Button } from './ui/button';
import { DialogContent, Dialog } from './ui/dialog';
import { Field, Input } from './ui/input';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from './ui/menu';
import { Avatar, Kbd } from './ui/misc';
import { CommandMenu, modKey, openCommandMenu } from './CommandMenu';
import { LiveDot } from './ui/spinner';

/**
 * Mercity's logo mark (cropped from mercity.ai's /no-background-logo.png).
 * Drawn as a mask so it takes the brand navy in light mode and the ink colour in dark mode.
 */
const markMask = `url(${import.meta.env.BASE_URL}mercity-mark.png) center / contain no-repeat`;

export function Logo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-7 shrink-0 bg-[#041535] dark:bg-ink', className)}
      style={{ mask: markMask, WebkitMask: markMask }}
    />
  );
}

function NavItem({ to, icon, label, count, end }: { to: string; icon: ReactNode; label: string; count?: number; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'group flex h-[34px] items-center gap-[10px] rounded-lg px-[9px] text-[13.5px] transition-colors [&_svg]:size-[18.5px] [&_svg]:stroke-[1.75]',
          isActive ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2 hover:bg-surface-2/70 hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span className={cn('transition-colors', isActive ? 'text-ink' : 'text-ink-3 group-hover:text-ink-2')}>{icon}</span>
          <span className="flex-1 truncate">{label}</span>
          {!!count && <span className="text-[11.5px] tabular text-ink-3">{count}</span>}
        </>
      )}
    </NavLink>
  );
}

function UserMenu({ user }: { user: User }) {
  const logout = useLogout();
  const [theme, setTheme] = useTheme();
  const [pwOpen, setPwOpen] = useState(false);
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <button
            className="group flex w-full items-center gap-[7.5px] rounded-[9px] border border-line-strong bg-surface p-[5.5px] text-left transition-colors hover:border-ink-4/70 hover:bg-surface-2 data-[state=open]:border-ink-4 data-[state=open]:bg-surface-2"
          >
            <Avatar name={user.name} size="sm" className="size-[27px] text-[11.5px]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium leading-[1.25]">{user.name}</span>
              <span className="block truncate text-[11px] leading-[1.25] text-ink-3">{user.email}</span>
            </span>
            <ChevronsUpDown className="-ml-0.5 size-[13px] shrink-0 text-ink-4 transition-colors group-hover:text-ink-3 group-data-[state=open]:text-ink-2" />
          </button>
        </MenuTrigger>
        <MenuContent side="top" align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
          <MenuItem onSelect={() => setPwOpen(true)}>
            <KeyRound /> Change password
          </MenuItem>
          <MenuSeparator />
          <MenuLabel>Theme</MenuLabel>
          {(
            [
              ['light', 'Light', <Sun key="s" />],
              ['dark', 'Dark', <Moon key="m" />],
              ['system', 'System', <Monitor key="c" />],
            ] as const
          ).map(([value, label, icon]) => (
            <MenuItem key={value} onSelect={(e) => (e.preventDefault(), setTheme(value))}>
              {icon} {label}
              {theme === value && <Check className="ml-auto !text-ink" />}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem onSelect={() => logout.mutate()}>
            <LogOut /> Sign out
          </MenuItem>
        </MenuContent>
      </Menu>
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </>
  );
}

function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) [setCurrent, setNext, setConfirm].forEach((f) => f('')), setError(null);
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 10) return setError('Use at least 10 characters.');
    if (next !== confirm) return setError('The new passwords don’t match.');
    setBusy(true);
    try {
      await api.post('/auth/password', { current, next });
      toast.success('Password updated');
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Change password" description="You’ll stay signed in on this device.">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Current password" htmlFor="pw-current">
            <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
          </Field>
          <Field label="New password" htmlFor="pw-next" hint="At least 10 characters.">
            <Input id="pw-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Confirm new password" htmlFor="pw-confirm" error={error}>
            <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy}>
              Update password
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Watches running pulls; when one lands, refreshes data and says what came in. */
function SyncWatcher() {
  const qc = useQueryClient();
  const { data: active } = useActiveSyncs();
  const prev = useRef<Map<number, string> | null>(null);

  useEffect(() => {
    if (!active) return;
    const now = new Map(active.map((a) => [a.id, a.kind]));
    const finished = prev.current ? [...prev.current].filter(([id]) => !now.has(id)) : [];
    prev.current = now;
    if (!finished.length) return;
    invalidateData(qc);
    qc.fetchQuery({ queryKey: keys.syncs, queryFn: () => api.get<{ runs: SyncRun[] }>('/syncs?limit=100').then((r) => r.runs) }).then(
      (runs) => {
        for (const [id, kind] of finished) {
          const run = runs.find((r) => r.id === id);
          if (!run || kind !== 'posts') continue;
          const who = run.contacts.length === 1 ? (run.contacts[0].name ?? run.contacts[0].slug) : plural(run.contactCount, 'person', 'people');
          if (run.status === 'failed') toast.error(`Pull failed for ${who}`, { description: run.error ?? undefined });
          else
            toast.success(run.newPosts ? `${plural(run.newPosts, 'new post')} from ${who}` : `No new posts from ${who}`, {
              description: run.records ? `${plural(run.records, 'post')} checked` : (run.contacts.find((c) => c.note)?.note ?? undefined),
            });
        }
      },
    );
  }, [active, qc]);

  return null;
}

function ActivePulls() {
  const { data } = useActiveSyncs();
  const runs = (data ?? []).filter((r) => r.kind === 'posts');
  const people = new Set(runs.flatMap((r) => r.contactIds)).size;
  if (!runs.length) return null;
  return (
    <Link
      to="/syncs"
      className="mx-[8px] mb-2 flex items-center gap-[10px] rounded-lg bg-accent-soft px-[11px] py-[6.5px] text-accent transition-opacity hover:opacity-85"
    >
      <LiveDot className="shrink-0" />
      <span className="min-w-0 leading-[1.3]">
        <span className="block truncate text-[12.5px] font-medium">Pulling posts</span>
        <span className="block truncate text-[11px] tabular opacity-80">{plural(people, 'person', 'people')}</span>
      </span>
    </Link>
  );
}

function SidebarContent({ user }: { user: User }) {
  const { data: overview } = useOverview();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[52px] items-center gap-[9px] px-[15px]">
        <Logo className="size-[30px]" />
        <div className="leading-[1.2]">
          <div className="text-[16.25px] font-semibold tracking-[-0.015em]">Pulse</div>
          <div className="text-[11.5px] text-ink-3">Mercity</div>
        </div>
      </div>
      <div className="px-[8px] pt-1">
        <button
          onClick={openCommandMenu}
          className="flex h-[34px] w-full items-center gap-[9px] rounded-lg border border-line bg-surface px-[9px] text-[13px] text-ink-3 transition-colors hover:border-line-strong hover:text-ink-2"
        >
          <Search className="size-[16px] stroke-[1.75]" />
          <span className="flex-1 text-left">Search</span>
          <span className="inline-flex gap-0.5">
            <Kbd>{modKey}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
      </div>
      <nav className="mt-2 flex flex-col gap-[3px] px-[8px]">
        <NavItem to="/" end icon={<LayoutGrid />} label="Overview" />
        <NavItem to="/feed" icon={<Newspaper />} label="Feed" count={overview?.kpis.openMine} />
        <NavItem to="/list" icon={<ListTodo />} label="Reply list" count={overview?.kpis.listTodo} />
        <NavItem to="/people" icon={<Users />} label="People" />
        <NavItem to="/syncs" icon={<History />} label="Pulls" />
        {user.role === 'admin' && (
          <>
            {/* Admin tools sit apart from day-to-day work. */}
            <div role="separator" className="mx-[9px] my-[7px] h-px bg-line" />
            <NavItem to="/team" icon={<UserCog />} label="Team" />
            <NavItem to="/brain" icon={<Brain />} label="Brain" />
          </>
        )}
      </nav>
      <div className="mt-auto pb-3">
        <ActivePulls />
        <div className="px-[8px]">
          <UserMenu user={user} />
        </div>
      </div>
    </div>
  );
}

export function Layout({ user, children }: { user: User; children: ReactNode }) {
  const [sheet, setSheet] = useState(false);
  const location = useLocation();
  useEffect(() => setSheet(false), [location.pathname]);
  // New page starts at the top (filter changes keep their scroll, since they only touch the query string).
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="min-h-dvh bg-bg">
      <SyncWatcher />
      <CommandMenu user={user} />
      <aside className="fixed inset-y-0 left-0 hidden w-[196px] border-r border-line bg-bg-subtle lg:block">
        <SidebarContent user={user} />
      </aside>

      {/* Phone / tablet: compact top bar + sheet */}
      <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-line bg-bg/95 px-3 backdrop-blur lg:hidden">
        <DialogPrimitive.Root open={sheet} onOpenChange={setSheet}>
          <DialogPrimitive.Trigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open menu">
              <MenuIcon />
            </Button>
          </DialogPrimitive.Trigger>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="anim-overlay fixed inset-0 z-40 bg-black/30" />
            <DialogPrimitive.Content aria-describedby={undefined} className="anim-sheet fixed inset-y-0 left-0 z-50 w-[272px] border-r border-line bg-bg-subtle focus:outline-none">
              <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
              <SidebarContent user={user} />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
        <Logo className="size-[24px]" />
        <span className="text-sm font-semibold">Pulse</span>
        <Button variant="ghost" size="icon" aria-label="Search" onClick={openCommandMenu} className="ml-auto">
          <Search />
        </Button>
      </header>

      <main className="lg:pl-[196px]">{children}</main>
    </div>
  );
}

/** Standard page header: one h1, an optional finding line, actions on the right. */
export function PageHeader({ title, sub, actions, back }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-6">
      {back}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em]">{title}</h1>
          {sub && <p className="mt-1 text-sm text-ink-3">{sub}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-[1240px] px-4 pb-16 pt-6 sm:px-8 sm:pt-8', className)}>{children}</div>;
}
