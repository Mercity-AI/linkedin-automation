import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Copy, KeyRound, MoreHorizontal, Pencil, Plus, Trash2, UserCheck, UserX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PageBody, PageHeader } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Select, Tooltip } from '@/components/ui/menu';
import { Avatar, Pill, Skeleton } from '@/components/ui/misc';
import { api, type Role, type TeamMember, type User } from '@/lib/api';
import { invalidateData, keys, useMe, useTeam } from '@/lib/queries';
import { cn, fmtDateTime, fmtNumber, fmtWhen, plural } from '@/lib/utils';

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check className="text-positive" /> : <Copy />}
      {done ? 'Copied' : label}
    </Button>
  );
}

function inviteText(user: Pick<User, 'name' | 'email'>, password: string, reset?: boolean) {
  const first = user.name.split(' ')[0];
  return [
    reset ? `Hi ${first}, your Pulse password was reset.` : `Hi ${first}, you now have access to Pulse.`,
    '',
    `Sign in: ${window.location.origin}`,
    `Email: ${user.email}`,
    `Password: ${password}`,
    '',
    'You can change your password from the menu under your name.',
  ].join('\n');
}

/** Shown once, right after a password is generated. */
function Credentials({
  user,
  password,
  reset,
  onDone,
}: {
  user: Pick<User, 'name' | 'email'>;
  password: string;
  reset?: boolean;
  onDone: () => void;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <div className="divide-y divide-line rounded-xl border border-line bg-bg-subtle">
        <div className="px-4 py-3">
          <div className="text-xs text-ink-3">Email</div>
          <div className="truncate text-sm font-medium">{user.email}</div>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="text-xs text-ink-3">Password</div>
            <div className="select-all font-mono text-[15px] tracking-wide">{password}</div>
          </div>
          <CopyButton value={password} label="Copy" />
        </div>
      </div>
      <p className="mt-3 text-[13px] text-ink-3">Shown only once. Send it to {user.name.split(' ')[0]} now.</p>
      <div className="mt-5 flex items-center justify-between gap-2">
        <CopyButton value={inviteText(user, password, reset)} label="Copy invite message" />
        <Button variant="primary" onClick={onDone}>
          Done
        </Button>
      </div>
    </motion.div>
  );
}

function MemberDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (v: boolean) => void; editing?: TeamMember | null }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ user: User; password: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? '');
    setEmail(editing?.email ?? '');
    setTitle(editing?.title ?? '');
    setRole(editing?.role ?? 'member');
    setError(null);
    setCreated(null);
  }, [open, editing]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { name, email, title: title || null, role };
      if (editing) {
        await api.patch(`/users/${editing.id}`, body);
        toast.success('Saved');
        onOpenChange(false);
      } else {
        setCreated(await api.post<{ user: User; password: string }>('/users', body));
      }
      qc.invalidateQueries({ queryKey: keys.team });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={created ? `${created.user.name} is in` : editing ? `Edit ${editing.name}` : 'Add a team member'}
        description={created ? undefined : editing ? undefined : 'They get a generated password you can send them.'}
      >
        {created ? (
          <Credentials user={created.user} password={created.password} onDone={() => onOpenChange(false)} />
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Field label="Name" htmlFor="m-name">
              <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoFocus required />
            </Field>
            <Field label="Email" htmlFor="m-email">
              <Input id="m-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@mercity.io" required />
            </Field>
            <div className="grid grid-cols-[1fr_140px] gap-3">
              <Field label="Title" htmlFor="m-title">
                <Input id="m-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="LinkedIn rep" />
              </Field>
              <div>
                <span className="mb-1.5 block text-[13px] font-medium">Role</span>
                <Select
                  value={role}
                  onValueChange={(v) => setRole(v as Role)}
                  className="w-full"
                  options={[
                    { value: 'member', label: 'Member' },
                    { value: 'admin', label: 'Admin' },
                  ]}
                />
              </div>
            </div>
            <p className="text-[13px] text-ink-3">Admins can add people to the team and reset passwords. Everyone can track people, pull posts and assign owners.</p>
            {error && <p className="text-[13px] text-negative">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={busy}>
                {editing ? 'Save' : 'Add and generate password'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResetDialog({ member, onOpenChange }: { member: TeamMember | null; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setPassword(null), [member]);
  return (
    <Dialog open={!!member} onOpenChange={onOpenChange}>
      <DialogContent
        title={password ? 'New password ready' : `Reset ${member?.name}’s password?`}
        description={password ? undefined : 'Their current password stops working and they’re signed out everywhere.'}
      >
        {member &&
          (password ? (
            <Credentials user={member} password={password} reset onDone={() => onOpenChange(false)} />
          ) : (
            <div className="flex justify-end gap-2">
              <Button onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                variant="primary"
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const res = await api.post<{ password: string }>(`/users/${member.id}/reset-password`);
                    setPassword(res.password);
                    qc.invalidateQueries({ queryKey: keys.team });
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Generate new password
              </Button>
            </div>
          ))}
      </DialogContent>
    </Dialog>
  );
}

export function TeamPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: team, isLoading } = useTeam();
  const [dialog, setDialog] = useState<{ editing: TeamMember | null } | null>(null);
  const [resetting, setResetting] = useState<TeamMember | null>(null);
  const [removing, setRemoving] = useState<TeamMember | null>(null);

  const active = (team ?? []).filter((u) => u.active);
  const admins = active.filter((u) => u.role === 'admin').length;

  async function setActive(u: TeamMember, value: boolean) {
    try {
      await api.patch(`/users/${u.id}`, { active: value });
      qc.invalidateQueries({ queryKey: keys.team });
      toast.success(value ? `${u.name} can sign in again` : `${u.name} is deactivated`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <PageBody>
      <PageHeader
        title="Team"
        sub={team ? `${plural(active.length, 'member')} · ${plural(admins, 'admin')}` : 'Loading…'}
        actions={
          <Button variant="primary" onClick={() => setDialog({ editing: null })}>
            <Plus /> Add member
          </Button>
        }
      />

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <table className="w-full text-[13px]">
          <thead className="whitespace-nowrap border-b border-line text-left text-ink-3">
            <tr className="h-10">
              <th className="px-5 font-normal">Member</th>
              <th className="hidden px-3 font-normal sm:table-cell">Role</th>
              <th className="hidden px-3 text-right font-normal md:table-cell">People</th>
              <th className="hidden px-3 text-right font-normal md:table-cell">Needs reply</th>
              <th className="hidden px-3 font-normal lg:table-cell">Last sign-in</th>
              <th className="hidden px-3 font-normal xl:table-cell">Password set</th>
              <th className="w-14" />
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              [0, 1, 2].map((i) => (
                <tr key={i} className="h-[60px] border-b border-line last:border-0">
                  <td className="px-5" colSpan={7}>
                    <Skeleton className="h-4 w-56" />
                  </td>
                </tr>
              ))}
            <AnimatePresence initial={false}>
              {(team ?? []).map((u) => (
                <motion.tr
                  key={u.id}
                  layout="position"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className={cn('h-[60px] border-b border-line last:border-0', !u.active && 'text-ink-3')}
                >
                  <td className="px-5">
                    <div className="flex items-center gap-3">
                      <Avatar name={u.name} className={cn(!u.active && 'opacity-50')} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn('truncate text-sm font-medium', u.active ? 'text-ink' : 'text-ink-3')}>{u.name}</span>
                          {u.id === me?.id && <span className="text-xs text-ink-3">you</span>}
                          {!u.active && <Pill>Deactivated</Pill>}
                        </div>
                        <div className="truncate text-ink-3">
                          {u.email}
                          {u.title && ` · ${u.title}`}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-3 sm:table-cell">{u.role === 'admin' ? <Pill tone="accent">Admin</Pill> : <Pill>Member</Pill>}</td>
                  <td className="hidden px-3 text-right tabular md:table-cell">{fmtNumber(u.contacts)}</td>
                  <td className="hidden px-3 text-right tabular md:table-cell">{u.openPosts ? fmtNumber(u.openPosts) : <span className="text-ink-4">0</span>}</td>
                  <td className="hidden px-3 text-ink-2 lg:table-cell">
                    <Tooltip content={u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : undefined}>
                      <span>{u.lastLoginAt ? fmtWhen(u.lastLoginAt) : <span className="text-ink-4">Never</span>}</span>
                    </Tooltip>
                  </td>
                  <td className="hidden px-3 text-ink-2 xl:table-cell">
                    <Tooltip content={fmtDateTime(u.passwordSetAt)}>
                      <span>{fmtWhen(u.passwordSetAt)}</span>
                    </Tooltip>
                  </td>
                  <td className="pr-3 text-right">
                    <Menu>
                      <MenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${u.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </MenuTrigger>
                      <MenuContent>
                        <MenuItem onSelect={() => setResetting(u)}>
                          <KeyRound /> Reset password
                        </MenuItem>
                        <MenuItem onSelect={() => setDialog({ editing: u })}>
                          <Pencil /> Edit details
                        </MenuItem>
                        {u.id !== me?.id && (
                          <>
                            <MenuSeparator />
                            {u.active ? (
                              <MenuItem onSelect={() => setActive(u, false)}>
                                <UserX /> Deactivate
                              </MenuItem>
                            ) : (
                              <MenuItem onSelect={() => setActive(u, true)}>
                                <UserCheck /> Reactivate
                              </MenuItem>
                            )}
                            <MenuItem danger onSelect={() => setRemoving(u)}>
                              <Trash2 /> Remove
                            </MenuItem>
                          </>
                        )}
                      </MenuContent>
                    </Menu>
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      <MemberDialog open={!!dialog} onOpenChange={(v) => !v && setDialog(null)} editing={dialog?.editing} />
      <ResetDialog member={resetting} onOpenChange={(v) => !v && setResetting(null)} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={`Remove ${removing?.name}?`}
        description={
          removing?.contacts
            ? `They lose access immediately. Their ${plural(removing.contacts, 'person', 'people')} become unassigned.`
            : 'They lose access immediately.'
        }
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await api.del(`/users/${removing.id}`);
            invalidateData(qc);
            toast.success(`Removed ${removing.name}`);
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />
    </PageBody>
  );
}
