import { Router } from 'express';
import { z } from 'zod';
import { db, nowIso, parseJson } from '../db.ts';
import { requestNotionSync } from '../notion.ts';

export const postsRouter = Router();

/** Every post query binds @me so we can say whether the post is on the viewer's reply list. */
export const POST_SELECT = `
  SELECT p.id, p.contact_id, p.li_id, p.url, p.kind, p.author_slug, p.author_name, p.author_title, p.author_avatar,
         p.author_url, p.title, p.text, p.posted_at, p.num_likes, p.num_comments, p.media, p.original, p.top_comments,
         p.status, p.handled_at, p.first_seen_at, h.name AS handled_by_name,
         c.slug AS c_slug, c.name AS c_name, c.headline AS c_headline, c.avatar_url AS c_avatar,
         c.role AS c_role, c.company AS c_company,
         c.eff_owner_id AS c_owner_id, o.name AS c_owner_name,
         rl.added_at AS in_list_at, d.body AS draft_body, d.touch_type AS draft_type,
         (SELECT json_object('id', a.id, 'type', a.touch_type, 'notes', a.notes, 'by', au.name, 'at', a.occurred_at, 'inNotion', a.notion_id IS NOT NULL)
            FROM activities a LEFT JOIN users au ON au.id = a.user_id
           WHERE a.post_id = p.id ORDER BY a.occurred_at DESC LIMIT 1) AS last_touch
  FROM posts p
  JOIN people c ON c.id = p.contact_id
  LEFT JOIN users o ON o.id = c.eff_owner_id
  LEFT JOIN users h ON h.id = p.handled_by
  LEFT JOIN reply_list rl ON rl.post_id = p.id AND rl.user_id = @me
  LEFT JOIN reply_drafts d ON d.post_id = p.id AND d.user_id = @me`;

/**
 * Bright Data reports a shared LinkedIn article as a plain post. The tells: the image is an
 * "article-cover_image" and the title is "<Article title> | <Author> | <n> comments".
 */
function articleOf(media: { images?: string[] }, title: string | null) {
  const cover = media.images?.find((u) => u.includes('article-cover_image'));
  if (!cover) return null;
  return { title: title?.split(' | ')[0]?.trim() || null, cover };
}

export function serializePost(p: any) {
  const media = parseJson(p.media, { images: [] as string[], videos: [], videoThumb: null, document: null, link: null });
  const article = articleOf(media, p.title);
  return {
    id: p.id,
    liId: p.li_id,
    url: p.url,
    kind: p.kind as 'post' | 'quote' | 'repost',
    author: {
      slug: p.author_slug,
      name: p.author_name,
      title: p.author_title,
      avatarUrl: p.author_avatar,
      url: p.author_url,
    },
    title: p.title,
    text: p.text,
    postedAt: p.posted_at,
    likes: p.num_likes,
    comments: p.num_comments,
    // The article card shows the cover, so drop it from the image grid.
    media: article ? { ...media, images: media.images.filter((u: string) => u !== article.cover) } : media,
    article,
    original: parseJson(p.original, null),
    topComments: parseJson(p.top_comments, []),
    status: p.status,
    handledBy: p.handled_by_name ?? null,
    handledAt: p.handled_at,
    firstSeenAt: p.first_seen_at,
    inList: !!p.in_list_at,
    /** The viewer's unsent reply to this post. */
    draft: p.draft_body ? { body: p.draft_body as string, touchType: (p.draft_type as string) ?? 'Comment' } : null,
    lastTouch: parseJson(p.last_touch, null) as { id: number; type: string; notes: string | null; by: string | null; at: string; inNotion: number } | null,
    contact: {
      id: p.contact_id,
      slug: p.c_slug,
      name: p.c_name,
      headline: p.c_headline,
      role: p.c_role ?? null,
      company: p.c_company ?? null,
      avatarUrl: p.c_avatar,
      owner: p.c_owner_id ? { id: p.c_owner_id, name: p.c_owner_name } : null,
    },
  };
}

export const getPost = (id: number, me: number) => {
  const row = db.prepare(`${POST_SELECT} WHERE p.id = @id`).get({ id, me });
  return row ? serializePost(row) : null;
};

postsRouter.get('/', (req, res) => {
  const q = req.query;
  const where: string[] = [];
  const params: Record<string, unknown> = { me: req.user!.id };

  if (q.contact) {
    where.push('p.contact_id = @contact');
    params.contact = Number(q.contact);
  }
  if (q.owner === 'me') {
    where.push('c.eff_owner_id = @me');
  } else if (q.owner === 'unassigned') {
    where.push('c.eff_owner_id IS NULL');
  } else if (q.owner && /^\d+$/.test(String(q.owner))) {
    where.push('c.eff_owner_id = @owner');
    params.owner = Number(q.owner);
  }
  if (q.kind === 'post') where.push("p.kind = 'post'");
  else if (q.kind === 'repost') where.push("p.kind IN ('repost','quote')");
  if (q.status && ['open', 'replied', 'skipped'].includes(String(q.status))) {
    where.push('p.status = @status');
    params.status = String(q.status);
  }
  if (q.since) {
    where.push('p.posted_at >= @since');
    params.since = String(q.since);
  }
  const search = String(q.q ?? '').trim();
  if (search) {
    where.push('(p.text LIKE @q OR p.author_name LIKE @q OR c.name LIKE @q OR p.original LIKE @q OR p.title LIKE @q)');
    params.q = `%${search}%`;
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(Number(q.limit) || 30, 1), 100);
  const offset = Math.max(Number(q.offset) || 0, 0);
  const total = (db.prepare(`SELECT COUNT(*) n FROM posts p JOIN people c ON c.id = p.contact_id ${clause}`).get(params) as any).n;
  const rows = db
    .prepare(`${POST_SELECT} ${clause} ORDER BY COALESCE(p.posted_at, p.first_seen_at) DESC, p.id DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });
  res.json({ posts: rows.map(serializePost), total, offset, limit });
});

postsRouter.patch('/:id', (req, res) => {
  const body = z.object({ status: z.enum(['open', 'replied', 'skipped']) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid status' });
  const open = body.data.status === 'open';
  const info = db
    .prepare('UPDATE posts SET status = ?, handled_by = ?, handled_at = ? WHERE id = ?')
    .run(body.data.status, open ? null : req.user!.id, open ? null : nowIso(), Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ post: getPost(Number(req.params.id), req.user!.id) });
});

export const TOUCH_TYPES = ['Comment', 'Post', 'DM', 'Connect Request', 'Profile View'] as const;

/** Log what we did on this post (usually a comment) and mark it replied. */
postsRouter.post('/:id/log', (req, res) => {
  const body = z
    .object({
      touchType: z.enum(TOUCH_TYPES).default('Comment'),
      notes: z.string().trim().max(5000).optional().nullable(),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid request' });
  const id = Number(req.params.id);
  const post = db.prepare('SELECT contact_id FROM posts WHERE id = ?').get(id) as { contact_id: number } | undefined;
  if (!post) return res.status(404).json({ error: 'Not found' });
  const now = nowIso();
  const activityId = db.transaction(() => {
    const { id: activityId } = db
      .prepare(
        `INSERT INTO activities (contact_id, post_id, user_id, channel, touch_type, outcome, notes, occurred_at)
         VALUES (?, ?, ?, 'LinkedIn', ?, 'Sent', ?, ?) RETURNING id`,
      )
      .get(post.contact_id, id, req.user!.id, body.data.touchType, body.data.notes || null, now) as { id: number };
    db.prepare("UPDATE posts SET status = 'replied', handled_by = ?, handled_at = ? WHERE id = ?").run(req.user!.id, now, id);
    db.prepare('DELETE FROM reply_drafts WHERE user_id = ? AND post_id = ?').run(req.user!.id, id);
    return activityId;
  })();
  requestNotionSync();
  res.status(201).json({ post: getPost(id, req.user!.id), activityId, contactId: post.contact_id });
});

/** Save (or, with an empty body, discard) the viewer's draft reply to a post. */
postsRouter.put('/:id/draft', (req, res) => {
  const body = z
    .object({ body: z.string().max(5000), touchType: z.enum(TOUCH_TYPES).default('Comment') })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid draft' });
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM posts WHERE id = ?').get(id)) return res.status(404).json({ error: 'Not found' });
  if (body.data.body.trim()) {
    db.prepare(
      `INSERT INTO reply_drafts (user_id, post_id, body, touch_type, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, post_id) DO UPDATE SET body = excluded.body, touch_type = excluded.touch_type, updated_at = excluded.updated_at`,
    ).run(req.user!.id, id, body.data.body, body.data.touchType, nowIso());
  } else {
    db.prepare('DELETE FROM reply_drafts WHERE user_id = ? AND post_id = ?').run(req.user!.id, id);
  }
  res.json({ post: getPost(id, req.user!.id) });
});
