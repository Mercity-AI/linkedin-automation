import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUpRight,
  BookmarkCheck,
  BookmarkPlus,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Link2,
  MessageCircle,
  MoreHorizontal,
  Trash2,
  Newspaper,
  PenLine,
  Play,
  Repeat2,
  RotateCcw,
  ThumbsUp,
  User as UserIcon,
} from 'lucide-react';
import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import type { Post, PostMedia } from '@/lib/api';
import { useSetPostStatus, useToggleList } from '@/lib/queries';
import { cn, fmtCompact, fmtDateTime, fmtNumber, fmtWhen, humanizeSlug } from '@/lib/utils';
import { Button } from './ui/button';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tooltip } from './ui/menu';
import { Avatar, Pill } from './ui/misc';
import { LoggedReply, ReplyComposer, useSendReply } from './touches';

const URL_RE = /(https?:\/\/[^\s)]+)/g;

function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            {p.replace(/^https?:\/\//, '').replace(/\?trk=.*$/, '')}
          </a>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

/** Text clamped to N lines with an inline "more" toggle that only appears when needed. */
function Clamped({ text, lines = 6, className }: { text: string; lines?: number; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setOverflows(el.scrollHeight > el.clientHeight + 2);
  }, [text, open]);
  return (
    <div className={className}>
      <p ref={ref} className="post-copy" style={open ? undefined : { display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        <Linkified text={text} />
      </p>
      {overflows && (
        <button onClick={() => setOpen((o) => !o)} className="mt-1 text-[13px] font-medium text-ink-3 transition-colors hover:text-ink">
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function hostOf(url: string | null) {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}

function Media({ media, postUrl }: { media: PostMedia; postUrl: string }) {
  const { images, videos, videoThumb, document, link } = media;

  if (videos.length || videoThumb) {
    return (
      <div className="relative mt-3 overflow-hidden rounded-xl bg-black">
        {videos[0] ? (
          <video src={videos[0]} poster={videoThumb ?? undefined} controls preload="none" playsInline className="max-h-[440px] w-full object-contain" />
        ) : (
          <a href={postUrl} target="_blank" rel="noreferrer" className="group block">
            <img src={videoThumb!} alt="" className="max-h-[440px] w-full object-cover opacity-90" loading="lazy" />
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid size-12 place-items-center rounded-full bg-white/90 text-black transition-transform group-hover:scale-105">
                <Play className="ml-0.5 size-5 fill-current" />
              </span>
            </span>
          </a>
        )}
      </div>
    );
  }

  if (document) {
    return (
      <a href={postUrl} target="_blank" rel="noreferrer" className="group mt-3 block overflow-hidden rounded-xl border border-line">
        <img src={document.cover} alt="" className="max-h-[420px] w-full object-cover object-top" loading="lazy" />
        <div className="flex items-center gap-2 border-t border-line bg-surface-2/60 px-3 py-2 text-[13px] text-ink-2">
          <FileText className="size-4 text-ink-3" />
          Document{document.pages ? ` · ${document.pages} pages` : ''}
          <ArrowUpRight className="ml-auto size-4 text-ink-3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </div>
      </a>
    );
  }

  if (link?.url && (link.title || link.image)) {
    return (
      <a
        href={link.url}
        target="_blank"
        rel="noreferrer"
        className="group mt-3 flex overflow-hidden rounded-xl border border-line transition-colors hover:bg-surface-2/50"
      >
        {link.image && <img src={link.image} alt="" className="h-[88px] w-[140px] shrink-0 object-cover max-sm:w-[96px]" loading="lazy" />}
        <div className="flex min-w-0 flex-col justify-center gap-0.5 px-3.5 py-2.5">
          <span className="line-clamp-2 text-[13px] font-medium leading-snug text-ink">{link.title ?? link.url}</span>
          <span className="flex items-center gap-1 text-xs text-ink-3">
            <Link2 className="size-3" /> {hostOf(link.url)}
          </span>
        </div>
      </a>
    );
  }

  if (images.length) {
    const shown = images.slice(0, 4);
    const extra = images.length - shown.length;
    return (
      <div className={cn('mt-3 grid gap-1 overflow-hidden rounded-xl', shown.length > 1 && 'grid-cols-2')}>
        {shown.map((src, i) => (
          <a
            key={src}
            href={postUrl}
            target="_blank"
            rel="noreferrer"
            className={cn('relative block overflow-hidden bg-surface-2', shown.length === 3 && i === 0 && 'row-span-2')}
          >
            <img
              src={src}
              alt=""
              loading="lazy"
              className={cn('w-full object-cover transition-transform duration-500 hover:scale-[1.015]', shown.length === 1 ? 'max-h-[480px]' : 'h-full max-h-[260px] min-h-[140px]')}
            />
            {extra > 0 && i === shown.length - 1 && (
              <span className="absolute inset-0 grid place-items-center bg-black/45 text-lg font-semibold text-white">+{extra}</span>
            )}
          </a>
        ))}
      </div>
    );
  }
  return null;
}

function StatusAction({ post, onLog }: { post: Post; onLog: () => void }) {
  const setStatus = useSetPostStatus();
  const toggleList = useToggleList();
  const pending = setStatus.isPending ? setStatus.variables?.status : null;
  if (post.status === 'open') {
    return (
      <>
        <Button size="sm" onClick={onLog}>
          <PenLine /> {post.draft ? 'Edit reply' : 'Write reply'}
        </Button>
        <Tooltip content={post.inList ? 'Remove from your reply list' : 'Save to your reply list to come back to'}>
          <Button
            size="sm"
            variant={post.inList ? 'secondary' : 'ghost'}
            loading={toggleList.isPending}
            onClick={() =>
              toggleList.mutate(
                { id: post.id, add: !post.inList },
                { onSuccess: () => toast.success(post.inList ? 'Removed from your reply list' : 'Added to your reply list') },
              )
            }
            className={cn(post.inList && 'text-ink')}
          >
            {!toggleList.isPending && (post.inList ? <BookmarkCheck className="text-accent" /> : <BookmarkPlus />)}
            {post.inList ? 'In your list' : 'Add to list'}
          </Button>
        </Tooltip>
        <Button size="sm" variant="ghost" loading={pending === 'skipped'} onClick={() => setStatus.mutate({ id: post.id, status: 'skipped' })}>
          Skip
        </Button>
      </>
    );
  }
  return (
    <Button size="sm" variant="ghost" loading={pending === 'open'} onClick={() => setStatus.mutate({ id: post.id, status: 'open' })}>
      <RotateCcw /> Reopen
    </Button>
  );
}

/** LinkedIn articles (long-form "Pulse" pieces) get a card that says so, not just a cover image. */
function ArticleCard({ article, url }: { article: NonNullable<Post['article']>; url: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="group mt-3 block overflow-hidden rounded-xl border border-line transition-colors hover:border-line-strong">
      <div className="aspect-[1.91/1] max-h-[300px] w-full overflow-hidden bg-surface-2">
        <img src={article.cover} alt="" loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.015]" />
      </div>
      <div className="flex items-start gap-3 border-t border-line px-3.5 py-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-accent">
            <Newspaper className="size-3.5" /> LinkedIn article
          </div>
          <div className="line-clamp-2 text-[15px] font-semibold leading-snug text-ink">{article.title ?? 'Read the article'}</div>
        </div>
        <span className="mt-5 inline-flex shrink-0 items-center gap-1 text-[13px] text-ink-3 transition-colors group-hover:text-ink">
          Read <ArrowUpRight className="size-3.5" />
        </span>
      </div>
    </a>
  );
}

function Comments({ post }: { post: Post }) {
  const [open, setOpen] = useState(false);
  if (!post.topComments.length) return null;
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-3 transition-colors hover:text-ink"
        aria-expanded={open}
      >
        {open ? 'Hide' : 'Show'} top comments
        <ChevronDown className={cn('size-3.5 transition-transform duration-200', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-2 pt-3">
              {post.topComments.map((c, i) => (
                <li key={i} className="flex gap-2.5">
                  <Avatar name={c.name} size="sm" className="mt-0.5" />
                  <div className="min-w-0 flex-1 rounded-xl bg-surface-2 px-3 py-2">
                    <div className="flex items-baseline gap-2">
                      {c.url ? (
                        <a href={c.url} target="_blank" rel="noreferrer" className="truncate text-[13px] font-medium hover:underline">
                          {c.name ?? c.slug}
                        </a>
                      ) : (
                        <span className="truncate text-[13px] font-medium">{c.name ?? c.slug}</span>
                      )}
                      <span className="shrink-0 text-xs text-ink-3">{fmtWhen(c.date)}</span>
                    </div>
                    <p className="post-copy mt-0.5 text-[13px] text-ink-2">{c.text}</p>
                  </div>
                </li>
              ))}
            </div>
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

export function PostCard({ post, showPerson = true, footerExtra }: { post: Post; showPerson?: boolean; footerExtra?: ReactNode }) {
  const [logging, setLogging] = useState(false);
  const sendReply = useSendReply();
  const toggleList = useToggleList();
  const person = post.contact.name ?? post.contact.slug;
  const isRepost = post.kind === 'repost';
  const authorName = post.author.name ?? humanizeSlug(post.author.slug) ?? person;
  const authorLink = isRepost ? post.author.url : `/people/${post.contact.id}`;

  return (
    <article className={cn('rounded-2xl border border-line bg-surface px-5 pb-3 pt-4 transition-colors', post.status !== 'open' && 'bg-bg-subtle')}>
      {isRepost && (
        <div className="mb-3 flex items-center gap-1.5 text-[13px] text-ink-3">
          <Repeat2 className="size-4" />
          {showPerson ? (
            <Link to={`/people/${post.contact.id}`} className="font-medium text-ink-2 hover:underline">
              {person}
            </Link>
          ) : (
            <span className="font-medium text-ink-2">{person}</span>
          )}
          reposted this
        </div>
      )}

      <header className="flex items-start gap-3">
        {isRepost ? (
          <a href={post.author.url ?? '#'} target="_blank" rel="noreferrer" className="shrink-0">
            <Avatar src={post.author.avatarUrl} name={authorName} size="md" />
          </a>
        ) : (
          <Link to={authorLink!} className="shrink-0">
            <Avatar src={post.contact.avatarUrl ?? post.author.avatarUrl} name={authorName} size="md" />
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {isRepost ? (
              <a href={post.author.url ?? '#'} target="_blank" rel="noreferrer" className="truncate text-sm font-semibold hover:underline">
                {authorName}
              </a>
            ) : (
              <Link to={authorLink!} className="truncate text-sm font-semibold hover:underline">
                {authorName}
              </Link>
            )}
            <span className="text-ink-4">·</span>
            <Tooltip content={fmtDateTime(post.postedAt)}>
              <a href={post.url} target="_blank" rel="noreferrer" className="shrink-0 text-[13px] text-ink-3 hover:underline">
                {fmtWhen(post.postedAt)}
              </a>
            </Tooltip>
            {post.kind === 'quote' && (
              <span className="inline-flex shrink-0 items-center gap-1 text-[13px] text-ink-3">
                <span className="text-ink-4">·</span>
                <Repeat2 className="size-3.5" /> Repost
              </span>
            )}
          </div>
          {(post.author.title || (!isRepost && post.contact.headline)) && (
            <p className="truncate text-[13px] text-ink-3">{post.author.title ?? post.contact.headline}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {post.status === 'replied' && (
            <Tooltip content={post.handledBy ? `Logged by ${post.handledBy} · ${fmtDateTime(post.handledAt)}` : undefined}>
              <span>
                <Pill tone="positive">
                  <Check className="size-3" strokeWidth={3} /> Replied
                </Pill>
              </span>
            </Tooltip>
          )}
          {post.status === 'skipped' && <Pill>Skipped</Pill>}
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More actions" className="-mr-1.5">
                <MoreHorizontal />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => window.open(post.url, '_blank', 'noreferrer')}>
                <ArrowUpRight /> Open on LinkedIn
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  navigator.clipboard.writeText(post.url);
                  toast.success('Link copied');
                }}
              >
                <Link2 /> Copy link
              </MenuItem>
              {showPerson && (
                <MenuItem asChild>
                  <Link to={`/people/${post.contact.id}`}>
                    <UserIcon /> View {person}
                  </Link>
                </MenuItem>
              )}
              {post.inList && (
                <>
                  <MenuSeparator />
                  <MenuItem
                    danger
                    onSelect={() =>
                      toggleList.mutate({ id: post.id, add: false }, { onSuccess: () => toast.success('Removed from your reply list') })
                    }
                  >
                    <Trash2 /> Remove from reply list
                  </MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>
        </div>
      </header>

      {post.text && <Clamped text={post.text} className="mt-3 text-sm leading-[1.6] text-ink" />}

      {post.kind === 'quote' && post.original && (
        <div className="mt-3 rounded-xl border border-line p-3 transition-colors hover:border-line-strong">
          <a href={post.original.url ?? post.url} target="_blank" rel="noreferrer" className="block px-1">
            <div className="flex items-center gap-2 text-[13px]">
              <Avatar name={post.original.authorName ?? humanizeSlug(post.original.authorSlug)} size="xs" />
              <span className="font-medium hover:underline">
                {post.original.authorName ?? humanizeSlug(post.original.authorSlug) ?? 'Original post'}
              </span>
              {post.original.date && <span className="text-ink-3">· {fmtWhen(post.original.date)}</span>}
            </div>
            {post.original.text && (
              <p className="post-copy mt-1.5 line-clamp-4 text-[13px] leading-relaxed text-ink-2">{post.original.text}</p>
            )}
          </a>
          {post.article && <ArticleCard article={post.article} url={post.original.url ?? post.url} />}
          <Media media={post.media} postUrl={post.original.url ?? post.url} />
        </div>
      )}

      {!(post.kind === 'quote' && post.original) && (
        <>
          {post.article && <ArticleCard article={post.article} url={post.url} />}
          <Media media={post.media} postUrl={post.url} />
        </>
      )}

      <div className="mt-3 flex items-center gap-4 text-[13px] text-ink-3 tabular">
        <span className="inline-flex items-center gap-1.5">
          <ThumbsUp className="size-3.5" /> {fmtCompact(post.likes)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MessageCircle className="size-3.5" /> {fmtNumber(post.comments)}
        </span>
        {showPerson && (
          <span className="ml-auto inline-flex min-w-0 items-center gap-1.5">
            {post.contact.owner ? (
              <>
                <Avatar name={post.contact.owner.name} size="xs" />
                <span className="truncate text-ink-2">{post.contact.owner.name}</span>
              </>
            ) : (
              <span className="text-ink-4">Unassigned</span>
            )}
          </span>
        )}
      </div>

      <Comments post={post} />

      {post.status === 'replied' && post.lastTouch && <LoggedReply post={post} />}

      {post.status === 'open' && post.draft && (
        <button
          onClick={() => setLogging(true)}
          className="mt-3 block w-full rounded-xl border border-dashed border-line-strong px-3 py-2 text-left text-[13px] transition-colors hover:bg-surface-2/60"
        >
          <span className="text-xs font-medium text-ink-3">Your draft {post.draft.touchType === 'DM' ? 'message' : 'reply'} · click to edit</span>
          <span className="post-copy mt-0.5 line-clamp-3 block text-ink-2">{post.draft.body}</span>
        </button>
      )}

      <footer className="-mx-2 mt-3 flex flex-wrap items-center gap-1.5 border-t border-line px-2 pt-3">
        <Tooltip content={post.status === 'open' && post.draft ? 'Copies your draft, opens the post and logs your reply' : undefined}>
          <Button
            size="sm"
            variant="primary"
            loading={sendReply.isPending}
            onClick={() =>
              post.status === 'open' && post.draft
                ? sendReply.send(post, post.draft.body, post.draft.touchType, { open: true })
                : window.open(post.url, '_blank', 'noreferrer')
            }
          >
            {post.status === 'open' && post.draft && <Copy />}
            {post.status === 'open' && post.draft ? 'Copy & reply on LinkedIn' : 'Reply on LinkedIn'} <ArrowUpRight />
          </Button>
        </Tooltip>
        <StatusAction post={post} onLog={() => setLogging(true)} />
        {footerExtra}
      </footer>
      <ReplyComposer post={logging ? post : null} onOpenChange={(v) => !v && setLogging(false)} />
    </article>
  );
}

export function PostCardSkeleton() {
  return (
    <div className="rounded-2xl border border-line bg-surface px-5 pb-4 pt-4">
      <div className="flex items-center gap-3">
        <div className="size-9 rounded-full bg-surface-2" />
        <div className="space-y-1.5">
          <div className="h-3.5 w-40 rounded bg-surface-2" />
          <div className="h-3 w-56 rounded bg-surface-2" />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <div className="h-3.5 w-full rounded bg-surface-2" />
        <div className="h-3.5 w-[92%] rounded bg-surface-2" />
        <div className="h-3.5 w-[64%] rounded bg-surface-2" />
      </div>
      <div className="mt-4 h-8 w-64 rounded-lg bg-surface-2" />
    </div>
  );
}
