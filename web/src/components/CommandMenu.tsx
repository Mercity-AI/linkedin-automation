import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import {
  Brain,
  Building2,
  History,
  LayoutGrid,
  ListTodo,
  LogOut,
  Moon,
  Newspaper,
  RefreshCw,
  Search,
  Sun,
  UserCog,
  UserPlus,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api, type Contact, type User } from '@/lib/api';
import { keys, useLogout, useNotionSync } from '@/lib/queries';
import { isDarkNow, setTheme } from '@/lib/theme';
import { cn, displayName } from '@/lib/utils';
import { TierBadge } from './crm';
import { AddPeopleDialog } from './dialogs';
import { Avatar, Kbd } from './ui/misc';

const OPEN_EVENT = 'pulse:command-menu';
/** Lets any button open the command bar without prop drilling. */
export const openCommandMenu = () => window.dispatchEvent(new Event(OPEN_EVENT));

export const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? '⌘' : 'Ctrl';

function Item({
  value,
  keywords,
  icon,
  children,
  hint,
  onSelect,
}: {
  value: string;
  keywords?: string[];
  icon: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={value}
      keywords={keywords}
      onSelect={onSelect}
      className="flex h-10 cursor-default select-none items-center gap-3 rounded-lg px-2.5 text-[13.5px] text-ink outline-none transition-colors data-[selected=true]:bg-surface-2 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-3"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 truncate pl-3 text-xs text-ink-3">{hint}</span>}
    </Command.Item>
  );
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Stricter than cmdk's fuzzy default: every typed word has to appear in the item. Names that start with
 * the query rank first, then word starts, then anywhere ("openlayer" shouldn't match "Private AI").
 */
function filter(value: string, search: string, keywords?: string[]) {
  const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return 1;
  const label = value.toLowerCase().replace(/^(person \d+|company|page|view|action) /, '');
  const hay = `${label} ${(keywords ?? []).join(' ').toLowerCase()}`;
  if (!terms.every((t) => hay.includes(t))) return 0;
  if (label.startsWith(terms[0]!)) return 1;
  return terms.every((t) => new RegExp(`(^|[^a-z0-9])${escapeRe(t)}`).test(hay)) ? 0.8 : 0.4;
}

const group =
  '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-3';

export function CommandMenu({ user }: { user: User }) {
  const navigate = useNavigate();
  const logout = useLogout();
  const notionSync = useNotionSync();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);
  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  // People and companies are matched in the browser from the list the app already loads, so typing costs no queries.
  const { data: people } = useQuery({
    queryKey: keys.contacts({}),
    queryFn: () => api.get<{ contacts: Contact[] }>('/contacts').then((r) => r.contacts),
    enabled: open,
    staleTime: 60_000,
  });
  const companies = useMemo(() => {
    const seen = new Map<string, { name: string; tier: string | null; count: number }>();
    for (const c of people ?? []) {
      if (!c.company) continue;
      const k = c.company.toLowerCase();
      const entry = seen.get(k) ?? { name: c.company, tier: c.account?.tier ?? null, count: 0 };
      entry.count++;
      seen.set(k, entry);
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [people]);

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };
  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  const query = search.trim();
  const admin = user.role === 'admin';

  const pages: { to: string; label: string; icon: ReactNode; keywords?: string[] }[] = [
    { to: '/', label: 'Overview', icon: <LayoutGrid />, keywords: ['home', 'dashboard'] },
    { to: '/feed', label: 'Feed', icon: <Newspaper />, keywords: ['posts', 'reposts'] },
    { to: '/list', label: 'Reply list', icon: <ListTodo />, keywords: ['saved', 'later', 'todo'] },
    { to: '/people', label: 'People', icon: <Users />, keywords: ['crm', 'contacts'] },
    { to: '/syncs', label: 'Pulls', icon: <History />, keywords: ['bright data', 'history'] },
    ...(admin
      ? [
          { to: '/brain', label: 'Brain', icon: <Brain />, keywords: ['knowledge', 'notion', 'schedule', 'settings'] },
          { to: '/team', label: 'Team', icon: <UserCog />, keywords: ['members', 'invite', 'passwords'] },
        ]
      : []),
  ];

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="anim-overlay fixed inset-0 z-50 bg-black/25 dark:bg-black/55" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="anim-dialog fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-32px)] max-w-[600px] -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-surface shadow-pop focus:outline-none"
          >
            <DialogPrimitive.Title className="sr-only">Search and commands</DialogPrimitive.Title>
            <Command loop filter={filter} className="flex max-h-[min(560px,70vh)] flex-col">
              <div className="flex items-center gap-2.5 border-b border-line px-4">
                <Search className="size-4 shrink-0 text-ink-3" />
                <Command.Input
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Search people, companies, pages…"
                  className="h-12 w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-4"
                />
                <Kbd>Esc</Kbd>
              </div>

              <Command.List className="scrollbar-thin overflow-y-auto overscroll-contain px-2 pb-2">
                <Command.Empty className="px-3 py-8 text-center text-[13px] text-ink-3">No matches.</Command.Empty>

                {query && (people?.length ?? 0) > 0 && (
                  <Command.Group heading="People" className={group}>
                    {people!.map((c) => (
                      <Item
                        key={c.id}
                        value={`person ${c.id} ${displayName(c)}`}
                        keywords={[c.company ?? '', c.role ?? c.headline ?? '', c.slug].filter(Boolean)}
                        icon={<Avatar src={c.avatarUrl} name={c.name ?? c.slug} size="xs" className="!size-6" />}
                        hint={[c.role ?? c.headline, c.company].filter(Boolean).join(' · ')}
                        onSelect={() => go(`/people/${c.id}`)}
                      >
                        {displayName(c)}
                      </Item>
                    ))}
                  </Command.Group>
                )}

                {query && companies.length > 0 && (
                  <Command.Group heading="Companies" className={group}>
                    {companies.map((co) => (
                      <Item
                        key={co.name}
                        value={`company ${co.name}`}
                        icon={<Building2 />}
                        hint={`${co.count} ${co.count === 1 ? 'person' : 'people'}`}
                        onSelect={() => go(`/people?q=${encodeURIComponent(co.name)}`)}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {co.name} <TierBadge tier={co.tier} />
                        </span>
                      </Item>
                    ))}
                  </Command.Group>
                )}

                <Command.Group heading="Go to" className={group}>
                  {pages.map((p) => (
                    <Item key={p.to} value={`page ${p.label}`} keywords={p.keywords} icon={p.icon} onSelect={() => go(p.to)}>
                      {p.label}
                    </Item>
                  ))}
                  <Item value="view posts that need your reply" keywords={['queue', 'mine', 'open']} icon={<Newspaper />} onSelect={() => go('/feed?owner=me&status=open')}>
                    Posts that need your reply
                  </Item>
                  <Item value="view your people" keywords={['mine', 'assigned']} icon={<Users />} onSelect={() => go('/people?owner=me')}>
                    Your people
                  </Item>
                  <Item value="view tier a people" keywords={['priority', 'accounts']} icon={<Users />} onSelect={() => go('/people?tier=A')}>
                    Tier A people
                  </Item>
                </Command.Group>

                <Command.Group heading="Actions" className={group}>
                  <Item value="action add people" keywords={['new', 'linkedin', 'track']} icon={<UserPlus />} onSelect={() => run(() => setAddOpen(true))}>
                    Add people
                  </Item>
                  {admin && (
                    <Item
                      value="action sync with notion"
                      keywords={['abm', 'crm', 'refresh']}
                      icon={<RefreshCw />}
                      onSelect={() =>
                        run(() =>
                          toast.promise(notionSync.mutateAsync(), {
                            loading: 'Syncing with Notion…',
                            success: 'Synced with Notion',
                            error: (e) => (e as Error).message,
                          }),
                        )
                      }
                    >
                      Sync with Notion
                    </Item>
                  )}
                  <Item
                    value="action switch theme"
                    keywords={['dark', 'light', 'mode', 'appearance']}
                    icon={isDarkNow() ? <Sun /> : <Moon />}
                    onSelect={() => run(() => setTheme(isDarkNow() ? 'light' : 'dark'))}
                  >
                    Switch to {isDarkNow() ? 'light' : 'dark'} theme
                  </Item>
                  <Item value="action sign out" keywords={['logout', 'log out']} icon={<LogOut />} onSelect={() => run(() => logout.mutate())}>
                    Sign out
                  </Item>
                </Command.Group>

                {/* Post text is searched on the server only when asked for, not on every keystroke. */}
                {query.length > 1 && (
                  <Command.Group heading="Posts" className={group} forceMount>
                    <Command.Item
                      value={`search posts for ${query}`}
                      forceMount
                      onSelect={() => go(`/feed?q=${encodeURIComponent(query)}`)}
                      className="flex h-10 cursor-default select-none items-center gap-3 rounded-lg px-2.5 text-[13.5px] text-ink outline-none transition-colors data-[selected=true]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-ink-3"
                    >
                      <Search />
                      <span className="min-w-0 flex-1 truncate">
                        Search posts for <span className="font-medium">“{query}”</span>
                      </span>
                      <span className="text-xs text-ink-3">Feed</span>
                    </Command.Item>
                  </Command.Group>
                )}
              </Command.List>

              <div className={cn('flex items-center gap-4 border-t border-line px-4 py-2 text-xs text-ink-3')}>
                <span className="inline-flex items-center gap-1.5">
                  <Kbd>↑</Kbd>
                  <Kbd>↓</Kbd> move
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Kbd>↵</Kbd> open
                </span>
                <span className="ml-auto inline-flex items-center gap-1.5">
                  <Kbd>{modKey}</Kbd>
                  <Kbd>K</Kbd> anywhere
                </span>
              </div>
            </Command>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      <AddPeopleDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}
