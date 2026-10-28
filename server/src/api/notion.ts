import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth.ts';
import { setSetting } from '../db.ts';
import { notionConnectionInfo, notionSyncStatus, syncNotion } from '../notion.ts';

/** Admin controls for the Notion ABM CRM sync. */
export const notionRouter = Router();

notionRouter.get('/', requireAdmin, async (_req, res) => {
  res.json({ status: notionSyncStatus(), connection: await notionConnectionInfo() });
});

notionRouter.post('/sync', requireAdmin, async (req, res) => {
  const result = await syncNotion('manual', req.user!.name);
  res.status(result.ok ? 200 : 502).json({ result, status: notionSyncStatus() });
});

notionRouter.patch('/', requireAdmin, (req, res) => {
  const body = z.object({ hours: z.union([z.literal(0), z.literal(6), z.literal(12), z.literal(24)]) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid schedule' });
  setSetting('notion_sync_hours', String(body.data.hours));
  res.json({ status: notionSyncStatus() });
});
