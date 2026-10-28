import { Router } from 'express';
import { db } from '../db.ts';
import { getPost, POST_SELECT, serializePost } from './posts.ts';

/** The signed-in teammate's reply list. */
export const listRouter = Router();

// To reply: open posts on my list. Done: handled posts on my list, plus every post I've logged a reply on.
const TODO = "rl.user_id IS NOT NULL AND p.status = 'open'";
const DONE = `p.status != 'open' AND (rl.user_id IS NOT NULL OR EXISTS (SELECT 1 FROM activities a WHERE a.post_id = p.id AND a.user_id = @me))`;

listRouter.get('/', (req, res) => {
  const done = req.query.view === 'done';
  const rows = db
    .prepare(
      `${POST_SELECT} WHERE ${done ? DONE : TODO}
       ORDER BY ${done ? 'COALESCE(p.handled_at, rl.added_at) DESC' : 'COALESCE(p.posted_at, p.first_seen_at) DESC'}`,
    )
    .all({ me: req.user!.id });
  const counts = db
    .prepare(
      `SELECT SUM(${TODO}) AS todo, SUM(${DONE}) AS done
       FROM posts p LEFT JOIN reply_list rl ON rl.post_id = p.id AND rl.user_id = @me
       WHERE rl.user_id IS NOT NULL OR EXISTS (SELECT 1 FROM activities a WHERE a.post_id = p.id AND a.user_id = @me)`,
    )
    .get({ me: req.user!.id }) as { todo: number | null; done: number | null };
  res.json({ posts: rows.map(serializePost), counts: { todo: counts.todo ?? 0, done: counts.done ?? 0 } });
});

listRouter.post('/:postId', (req, res) => {
  const id = Number(req.params.postId);
  if (!db.prepare('SELECT 1 FROM posts WHERE id = ?').get(id)) return res.status(404).json({ error: 'Not found' });
  db.prepare('INSERT INTO reply_list (user_id, post_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(req.user!.id, id);
  res.status(201).json({ post: getPost(id, req.user!.id) });
});

listRouter.delete('/:postId', (req, res) => {
  const id = Number(req.params.postId);
  db.prepare('DELETE FROM reply_list WHERE user_id = ? AND post_id = ?').run(req.user!.id, id);
  res.json({ post: getPost(id, req.user!.id) });
});
