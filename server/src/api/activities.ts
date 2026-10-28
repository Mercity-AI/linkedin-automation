import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.ts';
import { requestNotionSync, trashNotionPage, updateNotionActivity } from '../notion.ts';
import { serializeActivity } from './contacts.ts';

/** Edit or delete a touch. Changes reach the matching Notion Activity right away, so a sync can't bring it back. */
export const activitiesRouter = Router();

const load = (id: number) =>
  db
    .prepare('SELECT a.*, u.name AS user_name, p.url AS post_url FROM activities a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN posts p ON p.id = a.post_id WHERE a.id = ?')
    .get(id) as any;

activitiesRouter.patch('/:id', async (req, res) => {
  const body = z
    .object({
      notes: z.string().trim().max(5000).nullable().optional(),
      touchType: z.enum(['Comment', 'Post', 'DM', 'Connect Request', 'Profile View']).optional(),
      outcome: z.enum(['Sent', 'Replied', 'Connected']).optional(),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid request' });
  const a = load(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Not found' });
  const next = {
    notes: body.data.notes === undefined ? a.notes : body.data.notes || null,
    touchType: body.data.touchType ?? a.touch_type,
    outcome: body.data.outcome ?? a.outcome,
  };
  if (a.notion_id) await updateNotionActivity(a.notion_id, { ...next, postUrl: a.post_url });
  db.prepare('UPDATE activities SET notes = ?, touch_type = ?, outcome = ? WHERE id = ?').run(next.notes, next.touchType, next.outcome, a.id);
  res.json({ activity: serializeActivity(load(a.id)) });
});

activitiesRouter.delete('/:id', async (req, res) => {
  const a = load(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (a.notion_id) await trashNotionPage(a.notion_id);
  db.transaction(() => {
    db.prepare('DELETE FROM activities WHERE id = ?').run(a.id);
    // If this was the only reply logged on the post, the post needs a reply again.
    if (a.post_id && !db.prepare('SELECT 1 FROM activities WHERE post_id = ?').get(a.post_id)) {
      db.prepare("UPDATE posts SET status = 'open', handled_by = NULL, handled_at = NULL WHERE id = ? AND status = 'replied'").run(a.post_id);
    }
    // Last Touch Date in Notion may move back.
    db.prepare('UPDATE contacts SET notion_dirty = (notion_id IS NOT NULL) WHERE id = ?').run(a.contact_id);
  })();
  requestNotionSync();
  res.json({ ok: true, postId: a.post_id, contactId: a.contact_id });
});
