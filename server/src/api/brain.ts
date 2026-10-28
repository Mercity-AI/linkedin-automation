import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth.ts';
import { db, nowIso } from '../db.ts';

/** The Brain: what Pulse knows about Mercity. Admins write it; later, reply drafting reads it. */
export const brainRouter = Router();
brainRouter.use(requireAdmin);

const serialize = (e: any) => ({
  id: e.id,
  title: e.title,
  body: e.body,
  position: e.position,
  updatedAt: e.updated_at,
  updatedBy: e.updated_by_name ?? null,
});

const list = () =>
  (db
    .prepare(
      `SELECT e.*, u.name AS updated_by_name FROM brain_entries e LEFT JOIN users u ON u.id = e.updated_by
       ORDER BY e.position, e.id`,
    )
    .all() as any[]).map(serialize);

brainRouter.get('/', (_req, res) => res.json({ entries: list() }));

const entry = z.object({ title: z.string().trim().min(1).max(120), body: z.string().max(20_000).default('') });

brainRouter.post('/', (req, res) => {
  const body = entry.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Give the entry a title.' });
  const { n } = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM brain_entries').get() as { n: number };
  db.prepare('INSERT INTO brain_entries (title, body, position, updated_by) VALUES (?, ?, ?, ?)').run(
    body.data.title,
    body.data.body,
    n,
    req.user!.id,
  );
  res.status(201).json({ entries: list() });
});

brainRouter.patch('/:id', (req, res) => {
  const body = entry.partial().safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid entry' });
  const info = db
    .prepare('UPDATE brain_entries SET title = COALESCE(?, title), body = COALESCE(?, body), updated_by = ?, updated_at = ? WHERE id = ?')
    .run(body.data.title ?? null, body.data.body ?? null, req.user!.id, nowIso(), Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ entries: list() });
});

brainRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM brain_entries WHERE id = ?').run(Number(req.params.id));
  res.json({ entries: list() });
});
