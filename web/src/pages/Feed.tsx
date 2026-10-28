import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { SearchInput, useOwnerOptions, useParamState } from '@/components/filters';
import { PageBody, PageHeader } from '@/components/Layout';
import { PostCard, PostCardSkeleton } from '@/components/PostCard';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/menu';
import { Avatar, Empty, Segmented } from '@/components/ui/misc';
import { useContacts, usePosts } from '@/lib/queries';
import { cn, displayName, fmtNumber, fmtWhenInline } from '@/lib/utils';

const STATUS = [
  { value: 'all', label: 'Any status' },
  { value: 'open', label: 'Needs reply' },
  { value: 'replied', label: 'Replied' },
  { value: 'skipped', label: 'Skipped' },
];

export function FeedPage() {
  const [q, setQ] = useParamState('q', '');
  // By default: original posts from the people assigned to you.
  const [kind, setKind] = useParamState<'all' | 'post' | 'repost'>('kind', 'post');
  const [owner, setOwner] = useParamState('owner', 'me');
  const [status, setStatus] = useParamState('status', 'all');
  const [contact, setContact] = useParamState('contact', '');
  const ownerOptions = useOwnerOptions();

  const filters = {
    q: q || undefined,
    kind: kind === 'all' ? undefined : kind,
    owner: owner === 'all' ? undefined : owner,
    status: status === 'all' ? undefined : status,
    contact: contact ? Number(contact) : undefined,
  };
  const posts = usePosts(filters);
  const items = useMemo(() => posts.data?.pages.flatMap((p) => p.posts) ?? [], [posts.data]);
  const total = posts.data?.pages[0]?.total ?? 0;

  const { data: people } = useContacts({ owner: owner === 'all' ? undefined : owner });
  const focused = people?.find((p) => String(p.id) === contact);

  // Infinite scroll: fetch the next page when the sentinel scrolls into view.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && posts.hasNextPage && !posts.isFetchingNextPage && posts.fetchNextPage(), {
      rootMargin: '600px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [posts]);

  const filtered = !!(q || kind !== 'post' || owner !== 'me' || status !== 'all' || contact);

  return (
    // 680 feed + 32 gap + 280 rail = 992, plus 64 padding: header and columns share one left edge.
    <PageBody className="max-w-[1056px]">
      <PageHeader
        title="Feed"
        sub={
          posts.isLoading
            ? 'Loading posts…'
            : total
              ? `${fmtNumber(total)} ${total === 1 ? 'post' : 'posts'}${filtered ? ' match these filters' : ' from people assigned to you'}`
              : 'Nothing here yet'
        }
      />

      <div className="sticky top-12 z-20 -mx-4 mb-5 flex flex-wrap items-center gap-2 border-b border-line bg-bg/90 px-4 py-2.5 backdrop-blur sm:-mx-8 sm:px-8 lg:top-0">
        <SearchInput value={q} onChange={setQ} placeholder="Search posts and people" className="w-full sm:w-64" />
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: 'All' },
            { value: 'post', label: 'Posts' },
            { value: 'repost', label: 'Reposts' },
          ]}
        />
        <Select size="sm" value={owner} onValueChange={setOwner} options={ownerOptions} ariaLabel="Owner" />
        <Select size="sm" value={status} onValueChange={setStatus} options={STATUS} ariaLabel="Status" />
        {focused && (
          <button
            onClick={() => setContact('')}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-surface-2 pl-1.5 pr-2 text-[13px] font-medium transition-colors hover:bg-surface-3"
          >
            <Avatar src={focused.avatarUrl} name={focused.name} size="xs" />
            {displayName(focused)}
            <X className="size-3.5 text-ink-3" />
          </button>
        )}
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,680px)_280px]">
        <div className="min-w-0">
          {posts.isLoading ? (
            <div className="space-y-4">
              {[0, 1, 2].map((i) => (
                <PostCardSkeleton key={i} />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line-strong">
              {filtered ? (
                <Empty title="No posts match these filters">Try another status or owner, or clear the search.</Empty>
              ) : (
                <Empty
                  title="No posts from your people yet"
                  action={
                    <Button onClick={() => setOwner('all')}>See everyone’s posts</Button>
                  }
                >
                  Posts from people assigned to you show up here. Assign people on the People page.
                </Empty>
              )}
            </div>
          ) : (
            <div className={cn('space-y-4 transition-opacity', posts.isPlaceholderData && 'opacity-60')}>
              <AnimatePresence initial={false}>
                {items.map((post) => (
                  <motion.div
                    key={post.id}
                    layout="position"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <PostCard post={post} />
                  </motion.div>
                ))}
              </AnimatePresence>
              <div ref={sentinel} />
              {posts.isFetchingNextPage && <PostCardSkeleton />}
              {!posts.hasNextPage && items.length > 3 && (
                <p className="py-4 text-center text-[13px] text-ink-3">That’s everything · {fmtNumber(total)} posts</p>
              )}
            </div>
          )}
        </div>

        <aside className="hidden xl:block">
          <div className="sticky top-20">
            <h2 className="mb-2 px-2 text-[13px] font-medium text-ink-3">People</h2>
            <div className="max-h-[calc(100dvh-140px)] space-y-0.5 overflow-y-auto scrollbar-thin">
              {(people ?? []).slice(0, 40).map((p) => (
                <button
                  key={p.id}
                  onClick={() => setContact(String(p.id) === contact ? '' : String(p.id))}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2',
                    String(p.id) === contact && 'bg-surface-2',
                  )}
                >
                  <Avatar src={p.avatarUrl} name={p.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{displayName(p)}</span>
                    <span className="block truncate text-xs text-ink-3">
                      {p.stats.lastPostAt ? `Last post ${fmtWhenInline(p.stats.lastPostAt)}` : 'No posts yet'}
                    </span>
                  </span>
                  {p.stats.open > 0 && <span className="text-xs tabular text-ink-3">{p.stats.open}</span>}
                </button>
              ))}
              {people && people.length === 0 && (
                <p className="px-2 text-[13px] text-ink-3">
                  No one tracked yet. <Link to="/people" className="text-accent hover:underline">Add people</Link>
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </PageBody>
  );
}
