import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.ts';
import { extractProfileSlugs, profileUrl } from '../linkedin.ts';
import { requestNotionSync } from '../notion.ts';
import { eligibility, getPullRules, idsForScope, pullSummary, type PullMode } from '../pulls.ts';
import { startPostsSync, startProfileSync } from '../sync.ts';

export const contactsRouter = Router();

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString();

const CONTACT_SELECT = `
  SELECT c.*, u.name AS owner_name, ao.name AS a_owner_name,
    (SELECT COUNT(*) FROM posts p WHERE p.contact_id = c.id) AS posts_total,
    (SELECT COUNT(*) FROM posts p WHERE p.contact_id = c.id AND p.posted_at >= @since) AS posts_recent,
    (SELECT COUNT(*) FROM posts p WHERE p.contact_id = c.id AND p.kind != 'post') AS reposts_total,
    (SELECT COUNT(*) FROM posts p WHERE p.contact_id = c.id AND p.status = 'open') AS posts_open,
    (SELECT MAX(p.posted_at) FROM posts p WHERE p.contact_id = c.id) AS last_post_at,
    (SELECT GROUP_CONCAT(DISTINCT r.kind) FROM sync_run_contacts rc JOIN sync_runs r ON r.id = rc.run_id
       WHERE rc.contact_id = c.id AND r.status = 'running') AS syncing,
    a.name AS a_name, a.website AS a_website, a.tier AS a_tier, a.size AS a_size, a.industry AS a_industry,
    a.stage AS a_stage, a.why_now AS a_why, a.notion_id AS a_notion_id
  FROM people c LEFT JOIN users u ON u.id = c.eff_owner_id LEFT JOIN accounts a ON a.id = c.account_id
  LEFT JOIN users ao ON ao.id = a.owner_id`;

const notionUrl = (id: string | null) => (id ? `https://www.notion.so/${id}` : null);

export function serializeActivity(a: any) {
  return {
    id: a.id,
    title: a.title,
    channel: a.channel,
    touchType: a.touch_type,
    outcome: a.outcome,
    notes: a.notes,
    occurredAt: a.occurred_at,
    by: a.user_name ?? null,
    postId: a.post_id,
    postUrl: a.post_url ?? null,
    source: a.source as 'pulse' | 'notion',
    notionUrl: notionUrl(a.notion_id),
  };
}

export function serializeContact(c: any, rules = getPullRules()) {
  return {
    id: c.id,
    slug: c.slug,
    url: c.linkedin_url,
    name: c.name,
    headline: c.headline,
    company: c.company,
    location: c.location,
    avatarUrl: c.avatar_url,
    followers: c.followers,
    notes: c.notes,
    // Effective owner: their own, or their company's (viaCompany).
    owner: c.eff_owner_id ? { id: c.eff_owner_id, name: c.owner_name, viaCompany: !!c.owner_via_company } : null,
    role: c.role,
    persona: c.persona,
    region: c.region,
    campaign: c.campaign,
    connection: c.connection,
    qualification: c.qualification,
    notionUrl: notionUrl(c.notion_id),
    pull: eligibility(c, rules),
    account: c.account_id
      ? {
          id: c.account_id,
          name: c.a_name,
          website: c.a_website,
          tier: c.a_tier,
          size: c.a_size,
          industry: c.a_industry,
          stage: c.a_stage,
          whyNow: c.a_why,
          notionUrl: notionUrl(c.a_notion_id),
          owner: c.account_owner_id ? { id: c.account_owner_id, name: c.a_owner_name } : null,
          pullMode: (c.account_pull_mode ?? 'auto') as PullMode,
        }
      : null,
    createdAt: c.created_at,
    profileSyncedAt: c.profile_synced_at,
    postsSyncedAt: c.posts_synced_at,
    stats: {
      total: c.posts_total ?? 0,
      recent: c.posts_recent ?? 0,
      reposts: c.reposts_total ?? 0,
      open: c.posts_open ?? 0,
      lastPostAt: c.last_post_at ?? null,
    },
    syncing: {
      posts: String(c.syncing ?? '').includes('posts'),
      profile: String(c.syncing ?? '').includes('profile'),
    },
  };
}

function ownerFilter(owner: unknown, userId: number) {
  if (owner === 'me') return { sql: 'c.eff_owner_id = @owner', owner: userId };
  if (owner === 'unassigned') return { sql: 'c.eff_owner_id IS NULL', owner: null };
  if (owner && /^\d+$/.test(String(owner))) return { sql: 'c.eff_owner_id = @owner', owner: Number(owner) };
  return null;
}

contactsRouter.get('/', (req, res) => {
  const where: string[] = [];
  const params: Record<string, unknown> = { since: daysAgo(30) };
  const of = ownerFilter(req.query.owner, req.user!.id);
  if (of) {
    where.push(of.sql);
    if (of.owner !== null) params.owner = of.owner;
  }
  const q = String(req.query.q ?? '').trim();
  if (q) {
    where.push(`(c.name LIKE @q OR c.slug LIKE @q OR c.headline LIKE @q OR c.role LIKE @q OR c.company LIKE @q OR a.name LIKE @q)`);
    params.q = `%${q}%`;
  }
  // Exact-match CRM filters: ?tier=A&persona=Champion&connection=Connected&account=12&qualification=Qualified
  const exact = { tier: 'a.tier', persona: 'c.persona', connection: 'c.connection', qualification: 'c.qualification', region: 'c.region' };
  for (const [key, column] of Object.entries(exact)) {
    const value = req.query[key];
    if (typeof value !== 'string' || !value) continue;
    if (value === 'none') where.push(`${column} IS NULL`);
    else {
      where.push(`${column} = @${key}`);
      params[key] = value;
    }
  }

  if (req.query.account && /^\d+$/.test(String(req.query.account))) {
    where.push('c.account_id = @account');
    params.account = Number(req.query.account);
  }
  const rows = db
    .prepare(
      `${CONTACT_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY COALESCE(last_post_at, '') DESC, COALESCE(a.tier, 'Z'), a.name COLLATE NOCASE, c.name COLLATE NOCASE`,
    )
    .all(params);
  const rules = getPullRules();
  let contacts = rows.map((r) => serializeContact(r, rules));
  // ?pulled=yes|no filters on the pull rules, which are evaluated here rather than in SQL.
  if (req.query.pulled === 'yes' || req.query.pulled === 'no') contacts = contacts.filter((c) => c.pull.eligible === (req.query.pulled === 'yes'));
  res.json({ contacts });
});

/** How many people the pull rules cover, and why the rest are left out. */
contactsRouter.get('/pull-summary', (_req, res) => res.json(pullSummary()));

/** Pull everyone the rules cover ('eligible'), or only those never pulled yet ('new'). */
contactsRouter.post('/pull', async (req, res) => {
  const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const body = z.object({ scope: z.enum(['eligible', 'new']), start: isoDay.optional(), end: isoDay.optional() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid request' });
  const ids = idsForScope(body.data.scope);
  if (!ids.length) return res.status(202).json({ runId: null, skipped: 0, excluded: 0, people: 0 });
  const result = await startPostsSync(ids, { start: body.data.start, end: body.data.end }, req.user!.id);
  res.status(202).json({ ...result, people: ids.length });
});

contactsRouter.get('/:id', (req, res) => {
  const row = db.prepare(`${CONTACT_SELECT} WHERE c.id = @id`).get({ id: Number(req.params.id), since: daysAgo(30) });
  if (!row) return res.status(404).json({ error: 'Not found' });
  const history = db
    .prepare(
      `SELECT r.id, r.kind, r.status, r.start_date, r.end_date, r.created_at, r.finished_at, r.error,
              rc.records, rc.new_posts, rc.note, u.name AS requested_by
       FROM sync_run_contacts rc JOIN sync_runs r ON r.id = rc.run_id LEFT JOIN users u ON u.id = r.requested_by
       WHERE rc.contact_id = ? ORDER BY r.created_at DESC LIMIT 12`,
    )
    .all(Number(req.params.id))
    .map((r: any) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      startDate: r.start_date,
      endDate: r.end_date,
      createdAt: r.created_at,
      finishedAt: r.finished_at,
      error: r.error,
      records: r.records,
      newPosts: r.new_posts,
      note: r.note,
      requestedBy: r.requested_by,
    }));
  const colleagues = (row as any).account_id
    ? (db
        .prepare(
          `SELECT c.id, c.name, c.slug, c.avatar_url, c.role, c.headline, u.name AS owner_name
           FROM people c LEFT JOIN users u ON u.id = c.eff_owner_id
           WHERE c.account_id = ? AND c.id != ? ORDER BY c.name COLLATE NOCASE`,
        )
        .all((row as any).account_id, Number(req.params.id)) as any[]).map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        avatarUrl: c.avatar_url,
        role: c.role ?? c.headline,
        owner: c.owner_name,
      }))
    : [];
  const activities = (db
    .prepare(
      `SELECT a.*, u.name AS user_name, p.url AS post_url FROM activities a
       LEFT JOIN users u ON u.id = a.user_id LEFT JOIN posts p ON p.id = a.post_id
       WHERE a.contact_id = ? ORDER BY a.occurred_at DESC, a.id DESC LIMIT 100`,
    )
    .all(Number(req.params.id)) as any[]).map(serializeActivity);
  res.json({ contact: serializeContact(row), history, colleagues, activities });
});

contactsRouter.post('/', async (req, res) => {
  const body = z
    .object({
      urls: z.array(z.string()).min(1).max(200),
      ownerId: z.number().int().nullable().optional(),
      pullPosts: z.boolean().default(true),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Paste at least one LinkedIn profile URL.' });

  const { slugs, invalid } = extractProfileSlugs(body.data.urls.join('\n'));

  const existing: number[] = [];
  const added: number[] = [];
  const insert = db.prepare(
    'INSERT INTO contacts (slug, linkedin_url, owner_id, created_by) VALUES (?, ?, ?, ?) ON CONFLICT(slug) DO NOTHING RETURNING id',
  );
  db.transaction(() => {
    for (const slug of slugs) {
      const row = insert.get(slug, profileUrl(slug), body.data.ownerId ?? null, req.user!.id) as { id: number } | undefined;
      if (row) added.push(row.id);
      else existing.push((db.prepare('SELECT id FROM contacts WHERE slug = ?').get(slug) as { id: number }).id);
    }
  })();

  const errors: string[] = [];
  if (added.length) {
    await startProfileSync(added, req.user!.id).catch((e) => errors.push(e.message));
    if (body.data.pullPosts) await startPostsSync(added, {}, req.user!.id).catch((e) => errors.push(e.message));
  }
  res.status(201).json({ added, existing, invalid, errors });
});

contactsRouter.patch('/', (req, res) => {
  const body = z
    .object({
      ids: z.array(z.number().int()).min(1),
      ownerId: z.number().int().nullable(),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid request' });
  const { ids, ownerId } = body.data;
  const setOwner = db.prepare('UPDATE contacts SET owner_id = ?, notion_dirty = (notion_id IS NOT NULL) WHERE id = ?');
  db.transaction(() => {
    for (const id of ids) setOwner.run(ownerId, id);
  })();
  requestNotionSync();
  res.json({ ok: true });
});

contactsRouter.patch('/:id', (req, res) => {
  const body = z
    .object({
      ownerId: z.number().int().nullable().optional(),
      notes: z.string().max(5000).nullable().optional(),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid request' });
  const id = Number(req.params.id);
  const current = db.prepare('SELECT owner_id, notes FROM contacts WHERE id = ?').get(id) as any;
  if (!current) return res.status(404).json({ error: 'Not found' });
  const ownerChanged = body.data.ownerId !== undefined && body.data.ownerId !== current.owner_id;
  db.prepare('UPDATE contacts SET owner_id = ?, notes = ?, notion_dirty = notion_dirty OR (? AND notion_id IS NOT NULL) WHERE id = ?').run(
    body.data.ownerId === undefined ? current.owner_id : body.data.ownerId,
    body.data.notes === undefined ? current.notes : body.data.notes,
    Number(ownerChanged),
    id,
  );
  if (ownerChanged) requestNotionSync();
  res.json({ ok: true });
});

contactsRouter.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM contacts WHERE id = ?').run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

contactsRouter.post('/sync', async (req, res) => {
  const body = z
    .object({ ids: z.array(z.number().int()).min(1).max(500), start: isoDay.optional(), end: isoDay.optional() })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Pick at least one person and a valid date range.' });
  const { ids, start, end } = body.data;
  if (start && end && start > end) return res.status(400).json({ error: 'Start date is after end date.' });
  const result = await startPostsSync(ids, { start, end }, req.user!.id);
  res.status(202).json(result);
});

contactsRouter.post('/:id/refresh-profile', async (req, res) => {
  const result = await startProfileSync([Number(req.params.id)], req.user!.id);
  res.status(202).json(result);
});

/** Log a touch that isn't tied to a post we pulled (a DM, a connection request, a profile view…). */
contactsRouter.post('/:id/activities', (req, res) => {
  const body = z
    .object({
      touchType: z.enum(['Comment', 'Post', 'DM', 'Connect Request', 'Profile View']),
      outcome: z.enum(['Sent', 'Replied', 'Connected']).default('Sent'),
      notes: z.string().trim().max(5000).optional().nullable(),
      occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid request' });
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM contacts WHERE id = ?').get(id)) return res.status(404).json({ error: 'Not found' });
  const occurred = body.data.occurredAt ? new Date(body.data.occurredAt).toISOString() : new Date().toISOString();
  const { id: activityId } = db
    .prepare(
      `INSERT INTO activities (contact_id, user_id, channel, touch_type, outcome, notes, occurred_at)
       VALUES (?, ?, 'LinkedIn', ?, ?, ?, ?) RETURNING id`,
    )
    .get(id, req.user!.id, body.data.touchType, body.data.outcome, body.data.notes || null, occurred) as { id: number };
  // A recorded acceptance means we're connected now.
  if (body.data.touchType === 'Connect Request') {
    db.prepare(
      "UPDATE contacts SET connection = CASE WHEN ? = 'Connected' THEN 'Connected' ELSE COALESCE(connection, 'Request Sent') END, notion_dirty = (notion_id IS NOT NULL) WHERE id = ?",
    ).run(body.data.outcome, id);
  }
  requestNotionSync();
  const row = db
    .prepare('SELECT a.*, u.name AS user_name, NULL AS post_url FROM activities a LEFT JOIN users u ON u.id = a.user_id WHERE a.id = ?')
    .get(activityId);
  res.status(201).json({ activity: serializeActivity(row) });
});
