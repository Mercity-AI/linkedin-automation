import { ArrowUpRight, Eye, MessageSquare, MoreHorizontal, Pencil, Repeat2, Send, Sparkles, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { Activity, Post } from '@/lib/api';
import { useDeleteActivity, useLogReply, useLogTouch, useSaveDraft, useUpdateActivity } from '@/lib/queries';
import { cn, fmtDateTime, fmtWhen, isoDay } from '@/lib/utils';
import { Button } from './ui/button';
import { ConfirmDialog, Dialog, DialogContent } from './ui/dialog';
import { Field, Input, Textarea } from './ui/input';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tooltip } from './ui/menu';
import { Avatar, Pill, Segmented } from './ui/misc';

/** Touch types mirror the Notion ABM CRM "Activities" database. */
export const TOUCH_META: Record<string, { label: string; icon: ReactNode }> = {
  Comment: { label: 'Comment', icon: <MessageSquare /> },
  Post: { label: 'Repost with thoughts', icon: <Repeat2 /> },
  DM: { label: 'Message', icon: <Send /> },
  'Connect Request': { label: 'Connection request', icon: <UserPlus /> },
  'Profile View': { label: 'Profile view', icon: <Eye /> },
};

const outcomeTone: Record<string, 'neutral' | 'positive' | 'accent'> = { Sent: 'neutral', Replied: 'accent', Connected: 'positive' };

// --- Write a reply, copy it, open LinkedIn, log it ------------------------------------

/**
 * The reply flow: copy the reply, open the post on LinkedIn (ready to paste), and log it on the person's
 * timeline. The toast offers a way to that timeline, and Undo in case it never got posted.
 */
export function useSendReply() {
  const log = useLogReply();
  const del = useDeleteActivity();
  const navigate = useNavigate();

  return {
    isPending: log.isPending,
    async send(post: Post, text: string, touchType: string, opts: { open: boolean }) {
      let copied = false;
      if (text.trim()) {
        try {
          await navigator.clipboard.writeText(text.trim());
          copied = true;
        } catch {
          copied = false;
        }
      }
      // Open after copying: the clipboard needs this tab focused.
      if (opts.open) window.open(post.url, '_blank', 'noreferrer');
      const res = await log.mutateAsync({ id: post.id, touchType, notes: text.trim() || undefined });
      const name = post.contact.name ?? 'their';
      toast.success(copied && opts.open ? 'Reply copied. Paste it on LinkedIn.' : 'Reply logged', {
        description: `Logged on ${name}’s timeline.`,
        duration: 10_000,
        action: { label: 'View timeline', onClick: () => navigate(`/people/${res.contactId}?tab=touches`) },
        cancel: {
          label: 'Undo',
          onClick: () => del.mutate(res.activityId, { onSuccess: () => toast.message('Reply removed', { description: 'The post needs a reply again.' }) }),
        },
      });
    },
  };
}

export function ReplyComposer({ post, onOpenChange }: { post: Post | null; onOpenChange: (open: boolean) => void }) {
  const send = useSendReply();
  const saveDraft = useSaveDraft();
  const [type, setType] = useState<'Comment' | 'Post' | 'DM'>('Comment');
  const [text, setText] = useState('');
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (post) {
      setType((post.draft?.touchType as 'Comment' | 'Post' | 'DM') ?? 'Comment');
      setText(post.draft?.body ?? '');
      setDirty(false);
    }
    // Only when a different post opens; the post object refreshes while a draft saves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.id]);

  // Keep the draft as you type, so closing the dialog never loses it.
  useEffect(() => {
    if (!post || !dirty) return;
    const t = setTimeout(() => {
      saveDraft.mutate({ id: post.id, body: text, touchType: type }, { onSuccess: () => setDirty(false) });
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, type, dirty]);

  function close() {
    if (post && dirty) saveDraft.mutate({ id: post.id, body: text, touchType: type });
    onOpenChange(false);
  }

  async function submit(open: boolean) {
    if (!post) return;
    await send.send(post, text, type, { open });
    onOpenChange(false);
  }

  const who = post?.kind === 'repost' ? (post.author.name ?? post.contact.name) : post?.contact.name;
  const verb = type === 'DM' ? 'message' : type === 'Post' ? 'repost' : 'reply';

  return (
    <Dialog open={!!post} onOpenChange={(v) => !v && close()}>
      <DialogContent
        title="Write your reply"
        description="Write it here, then we’ll copy it and open the post so you can paste it."
        className="max-w-[560px]"
        footer={
          <>
            <span className="mr-auto text-xs text-ink-3">
              {saveDraft.isPending ? 'Saving draft…' : text.trim() && !dirty ? 'Draft saved' : '⌘ Enter to copy and open'}
            </span>
            <Tooltip content="Already posted it on LinkedIn? Log it without opening the post.">
              <Button variant="ghost" loading={send.isPending} onClick={() => submit(false)}>
                Log only
              </Button>
            </Tooltip>
            <Button variant="primary" loading={send.isPending} onClick={() => submit(true)}>
              {text.trim() ? `Copy ${verb} & open LinkedIn` : 'Open LinkedIn & log'} <ArrowUpRight />
            </Button>
          </>
        }
      >
        {post && (
          <div className="mb-4 flex gap-2.5 rounded-xl bg-surface-2/70 px-3 py-2.5">
            <Avatar src={post.kind === 'repost' ? post.author.avatarUrl : post.contact.avatarUrl} name={who} size="sm" />
            <div className="min-w-0">
              <div className="text-[13px] font-medium">
                {who} <span className="font-normal text-ink-3">· {fmtWhen(post.postedAt)}</span>
              </div>
              <p className="line-clamp-2 text-[13px] text-ink-2">{post.article?.title ?? post.text ?? post.original?.text ?? post.title}</p>
            </div>
          </div>
        )}
        <div className="mb-3">
          <Segmented
            size="sm"
            value={type}
            onChange={(v) => {
              setType(v);
              setDirty(true);
            }}
            options={[
              { value: 'Comment', label: 'Comment' },
              { value: 'Post', label: 'Repost with thoughts' },
              { value: 'DM', label: 'Message' },
            ]}
          />
        </div>
        <Textarea
          autoFocus
          rows={7}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDirty(true);
          }}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && submit(true)}
          placeholder={type === 'DM' ? 'Write your message…' : 'Write your comment…'}
          className="resize-none text-sm leading-relaxed"
        />
        <p className="mt-2 text-xs text-ink-3">It’s saved on their timeline too, so whoever talks to them next knows what you said.</p>
      </DialogContent>
    </Dialog>
  );
}

// --- Log a touch that isn't a reply to a pulled post -------------------------

export function LogTouchDialog({ contactId, name, open, onOpenChange }: { contactId: number; name: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const log = useLogTouch(contactId);
  const [type, setType] = useState('Connect Request');
  const [outcome, setOutcome] = useState('Sent');
  const [date, setDate] = useState(isoDay(new Date()));
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (open) {
      setType('Connect Request');
      setOutcome('Sent');
      setDate(isoDay(new Date()));
      setNotes('');
    }
  }, [open]);

  async function submit() {
    await log.mutateAsync({ touchType: type, outcome, notes: notes.trim() || undefined, occurredAt: date });
    toast.success('Touch logged');
    onOpenChange(false);
  }

  const types = ['Connect Request', 'DM', 'Comment', 'Post', 'Profile View'];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Log a touch with ${name}`}
        description="For anything outside the feed: connection requests, messages, comments on posts Pulse didn’t pull."
        className="max-w-[520px]"
        footer={
          <>
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" loading={log.isPending} onClick={submit}>
              Log touch
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <span className="mb-1.5 block text-[13px] font-medium">Type</span>
            <div className="flex flex-wrap gap-1.5">
              {types.map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] transition-colors [&_svg]:size-3.5',
                    type === t ? 'border-ink bg-ink text-bg' : 'border-line-strong text-ink-2 hover:bg-surface-2',
                  )}
                >
                  {TOUCH_META[t]?.icon}
                  {TOUCH_META[t]?.label ?? t}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[1fr_160px] gap-3">
            <div>
              <span className="mb-1.5 block text-[13px] font-medium">Outcome</span>
              <Segmented
                value={outcome}
                onChange={setOutcome}
                options={[
                  { value: 'Sent', label: 'Sent' },
                  { value: 'Replied', label: 'They replied' },
                  ...(type === 'Connect Request' ? [{ value: 'Connected', label: 'Accepted' }] : []),
                ]}
              />
            </div>
            <Field label="Date" htmlFor="touch-date">
              <Input id="touch-date" type="date" value={date} max={isoDay(new Date())} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Notes" htmlFor="touch-notes">
            <Textarea id="touch-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} className="resize-none text-[13px]" />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Timeline -------------------------------------------------------------------

function TimelineItem({ a }: { a: Activity }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(a.notes ?? '');
  const [confirm, setConfirm] = useState(false);
  const update = useUpdateActivity();
  const del = useDeleteActivity();
  const meta = a.touchType ? TOUCH_META[a.touchType] : null;
  const long = (a.notes?.length ?? 0) > 220;
  const inNotion = !!a.notionUrl;

  return (
    <li className="group relative flex gap-3 pb-5 last:pb-0">
      <span className="relative z-10 grid size-7 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink-3 [&_svg]:size-3.5">
        {meta?.icon ?? <Sparkles />}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
          <span className="font-medium">{meta?.label ?? a.title ?? 'Touch'}</span>
          {a.outcome && a.outcome !== 'Sent' && <Pill tone={outcomeTone[a.outcome] ?? 'neutral'}>{a.outcome === 'Connected' ? 'Accepted' : a.outcome}</Pill>}
          {a.channel && a.channel !== 'LinkedIn' && <Pill>{a.channel}</Pill>}
          {!editing && (
            <span className="ml-auto flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              <Tooltip content="Edit note">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Edit touch"
                  onClick={() => {
                    setDraft(a.notes ?? '');
                    setEditing(true);
                  }}
                >
                  <Pencil />
                </Button>
              </Tooltip>
              <Tooltip content="Delete">
                <Button variant="ghost" size="icon-sm" aria-label="Delete touch" onClick={() => setConfirm(true)}>
                  <Trash2 />
                </Button>
              </Tooltip>
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-3">
          <Tooltip content={fmtDateTime(a.occurredAt)}>
            <span>{fmtWhen(a.occurredAt)}</span>
          </Tooltip>
          {a.by && <span>· {a.by}</span>}
          {a.postUrl && (
            <a href={a.postUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">
              · on this post <ArrowUpRight className="size-3" />
            </a>
          )}
          {inNotion && (
            <a href={a.notionUrl!} target="_blank" rel="noreferrer" className="hover:text-ink">
              · {a.source === 'notion' ? 'from Notion' : 'in Notion'}
            </a>
          )}
        </div>
        {editing ? (
          <div className="mt-2">
            <Textarea autoFocus rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} className="resize-none text-[13px]" />
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                loading={update.isPending}
                onClick={() =>
                  update.mutate(
                    { id: a.id, notes: draft.trim() || null },
                    { onSuccess: () => (setEditing(false), toast.success(inNotion ? 'Saved here and in Notion' : 'Saved')) },
                  )
                }
              >
                Save
              </Button>
            </div>
          </div>
        ) : (
          a.notes && (
            <div className="mt-1.5">
              <p className={cn('post-copy text-[13px] leading-relaxed text-ink-2', !open && long && 'line-clamp-3')}>{a.notes}</p>
              {long && (
                <button onClick={() => setOpen((o) => !o)} className="mt-0.5 text-xs font-medium text-ink-3 hover:text-ink">
                  {open ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          )
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete this ${(meta?.label ?? 'touch').toLowerCase()}?`}
        description={
          <>
            It’s removed from this timeline{inNotion ? ' and moved to the trash in Notion' : ''}.
            {a.postId ? ' If it was the only reply on that post, the post goes back to needing a reply.' : ''}
          </>
        }
        confirmLabel="Delete"
        onConfirm={() => del.mutateAsync(a.id).then(() => toast.success(inNotion ? 'Deleted here and in Notion' : 'Deleted'))}
      />
    </li>
  );
}

/** The reply logged on a post, shown on its card, with a menu to edit the note or delete the touch. */
export function LoggedReply({ post }: { post: Post }) {
  const t = post.lastTouch!;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(t.notes ?? '');
  const [confirm, setConfirm] = useState(false);
  const update = useUpdateActivity();
  const del = useDeleteActivity();
  const inNotion = !!t.inNotion;
  const what = t.type === 'Post' ? 'reposted with thoughts' : t.type === 'DM' ? 'messaged them' : 'commented';
  const noun = t.type === 'Post' ? 'repost' : t.type === 'DM' ? 'message' : 'comment';

  return (
    <div className="mt-3 rounded-xl bg-positive-soft/50 py-2 pl-3 pr-1.5 text-[13px]">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 text-xs font-medium text-positive">
          {t.by ?? 'We'} {what} ·{' '}
          <Tooltip content={fmtDateTime(t.at)}>
            <span>{fmtWhen(t.at)}</span>
          </Tooltip>
        </div>
        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Reply actions" className="-my-1 text-positive hover:bg-positive-soft">
              <MoreHorizontal />
            </Button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem
              onSelect={() => {
                setDraft(t.notes ?? '');
                setEditing(true);
              }}
            >
              <Pencil /> Edit note
            </MenuItem>
            <MenuSeparator />
            <MenuItem danger onSelect={() => setConfirm(true)}>
              <Trash2 /> Delete {noun}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      {editing ? (
        <div className="mt-1.5 pr-1.5">
          <Textarea autoFocus rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} className="resize-none bg-surface text-[13px]" />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={update.isPending}
              onClick={() =>
                update.mutate(
                  { id: t.id, notes: draft.trim() || null },
                  { onSuccess: () => (setEditing(false), toast.success(inNotion ? 'Saved here and in Notion' : 'Saved')) },
                )
              }
            >
              Save
            </Button>
          </div>
        </div>
      ) : (
        t.notes && <p className="post-copy mt-0.5 line-clamp-3 pr-1.5 text-ink-2">{t.notes}</p>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete this ${noun}?`}
        description={
          <>
            It’s removed from Pulse{inNotion ? ' and moved to the trash in Notion' : ''}. If it was the only reply on this post, the post goes
            back to needing a reply.
          </>
        }
        confirmLabel="Delete"
        onConfirm={() => del.mutateAsync(t.id).then(() => toast.success(inNotion ? 'Deleted here and in Notion' : 'Deleted'))}
      />
    </div>
  );
}

export function ActivityTimeline({ activities }: { activities: Activity[] }) {
  return (
    <ol className="relative before:absolute before:bottom-2 before:left-[13.5px] before:top-2 before:w-px before:bg-line">
      {activities.map((a) => (
        <TimelineItem key={a.id} a={a} />
      ))}
    </ol>
  );
}
