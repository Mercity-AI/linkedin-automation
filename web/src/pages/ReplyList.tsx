import { AnimatePresence, motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { useParamState } from '@/components/filters';
import { PageBody, PageHeader } from '@/components/Layout';
import { PostCard, PostCardSkeleton } from '@/components/PostCard';
import { buttonVariants } from '@/components/ui/button';
import { Empty, Segmented } from '@/components/ui/misc';
import { useReplyList } from '@/lib/queries';
import { cn, fmtNumber, plural } from '@/lib/utils';

export function ReplyListPage() {
  const [view, setView] = useParamState<'todo' | 'done'>('view', 'todo');
  const { data, isLoading, isPlaceholderData } = useReplyList(view);
  const counts = data?.counts;

  return (
    <PageBody className="max-w-[776px]">
      <PageHeader
        title="Reply list"
        sub={
          counts
            ? counts.todo
              ? `${plural(counts.todo, 'post')} you set aside to reply to.`
              : 'Posts you set aside to reply to. Add them from the Feed.'
            : ' '
        }
        actions={
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'todo', label: <>To reply{counts ? <span className="ml-1.5 text-ink-3 tabular">{fmtNumber(counts.todo)}</span> : null}</> },
              { value: 'done', label: <>Done{counts ? <span className="ml-1.5 text-ink-3 tabular">{fmtNumber(counts.done)}</span> : null}</> },
            ]}
          />
        }
      />

      {isLoading ? (
        <div className="space-y-4">
          <PostCardSkeleton />
          <PostCardSkeleton />
        </div>
      ) : !data?.posts.length ? (
        <div className="rounded-2xl border border-dashed border-line-strong">
          {view === 'todo' ? (
            <Empty
              title={counts?.done ? 'All caught up' : 'Your list is empty'}
              action={
                <Link to="/feed?status=open" className={buttonVariants({})}>
                  Go to the Feed
                </Link>
              }
            >
              Use “Add to list” on any post you want to come back to. Log your reply here when it’s done.
            </Empty>
          ) : (
            <Empty title="Nothing done yet">Posts you’ve replied to show up here, whether or not they were on your list.</Empty>
          )}
        </div>
      ) : (
        <div className={cn('space-y-4 transition-opacity', isPlaceholderData && 'opacity-60')}>
          <AnimatePresence initial={false} mode="popLayout">
            {data.posts.map((post) => (
              <motion.div
                key={post.id}
                layout="position"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 24, transition: { duration: 0.18 } }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <PostCard post={post} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </PageBody>
  );
}
