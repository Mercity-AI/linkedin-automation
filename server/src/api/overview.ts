import { Router } from 'express';
import { db } from '../db.ts';
import { POST_SELECT, serializePost } from './posts.ts';

export const overviewRouter = Router();

const day = 864e5;
const isoDaysAgo = (n: number) => new Date(Date.now() - n * day).toISOString();

overviewRouter.get('/', (req, res) => {
  const me = req.user!.id;
  const one = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;

  const people = one('SELECT COUNT(*) n FROM contacts');
  const unassigned = one('SELECT COUNT(*) n FROM people WHERE eff_owner_id IS NULL');
  const mine = one('SELECT COUNT(*) n FROM people WHERE eff_owner_id = ?', me);
  const week = one('SELECT COUNT(*) n FROM posts WHERE posted_at >= ?', isoDaysAgo(7));
  const prevWeek = one('SELECT COUNT(*) n FROM posts WHERE posted_at >= ? AND posted_at < ?', isoDaysAgo(14), isoDaysAgo(7));
  const openMine = one(
    "SELECT COUNT(*) n FROM posts p JOIN people c ON c.id = p.contact_id WHERE c.eff_owner_id = ? AND p.status = 'open'",
    me,
  );
  const openAll = one("SELECT COUNT(*) n FROM posts WHERE status = 'open'");
  const handledWeek = one("SELECT COUNT(*) n FROM posts WHERE status = 'replied' AND handled_at >= ?", isoDaysAgo(7));

  // Daily activity for the last 30 days (UTC days), split by kind so the client can switch series.
  const since = new Date(Date.now() - 29 * day);
  since.setUTCHours(0, 0, 0, 0);
  const daily = db
    .prepare(
      `SELECT substr(posted_at, 1, 10) AS d,
              SUM(kind = 'post') AS posts, SUM(kind != 'post') AS reposts
       FROM posts WHERE posted_at >= ? GROUP BY d`,
    )
    .all(since.toISOString()) as { d: string; posts: number; reposts: number }[];
  const byDay = new Map(daily.map((r) => [r.d, r]));
  const activity = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(since.getTime() + i * day).toISOString().slice(0, 10);
    const r = byDay.get(d);
    return { date: d, posts: r?.posts ?? 0, reposts: r?.reposts ?? 0 };
  });

  const active = db
    .prepare(
      `SELECT c.id, c.name, c.slug, c.avatar_url, c.headline, u.name AS owner_name, c.eff_owner_id AS owner_id,
              COUNT(p.id) AS n, MAX(p.posted_at) AS last
       FROM people c JOIN posts p ON p.contact_id = c.id AND p.posted_at >= ?
       LEFT JOIN users u ON u.id = c.eff_owner_id
       GROUP BY c.id ORDER BY n DESC, last DESC LIMIT 6`,
    )
    .all(isoDaysAgo(30))
    .map((r: any) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      avatarUrl: r.avatar_url,
      headline: r.headline,
      owner: r.owner_id ? { id: r.owner_id, name: r.owner_name } : null,
      posts: r.n,
      lastPostAt: r.last,
    }));

  const queue = db
    .prepare(`${POST_SELECT} WHERE c.eff_owner_id = @me AND p.status = 'open' ORDER BY p.posted_at DESC LIMIT 5`)
    .all({ me })
    .map(serializePost);
  const listTodo = one(
    "SELECT COUNT(*) n FROM reply_list rl JOIN posts p ON p.id = rl.post_id WHERE rl.user_id = ? AND p.status = 'open'",
    me,
  );

  // Week-over-week only means something once we've been collecting for two full weeks.
  const trackingSince = (db.prepare("SELECT MIN(created_at) AS t FROM sync_runs WHERE kind = 'posts' AND status = 'ready'").get() as {
    t: string | null;
  }).t;

  const lastSync = db.prepare("SELECT MAX(finished_at) AS t FROM sync_runs WHERE kind = 'posts' AND status = 'ready'").get() as {
    t: string | null;
  };

  res.json({
    kpis: { people, unassigned, mine, week, prevWeek, openMine, openAll, handledWeek, listTodo },
    activity,
    active,
    queue,
    lastSyncAt: lastSync.t,
    trackingSince,
  });
});
