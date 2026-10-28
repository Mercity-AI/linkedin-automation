import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth.ts';
import { db } from '../db.ts';
import { requestNotionSync } from '../notion.ts';
import { ELIGIBILITY_COLUMNS, eligibility, getPullRules } from '../pulls.ts';

/** Companies (ABM accounts): owner and pull setting, with how many of their people get pulled. */
export const accountsRouter = Router();

accountsRouter.get('/', (_req, res) => {
  const rules = getPullRules();
  const people = db
    .prepare(`SELECT account_id, ${ELIGIBILITY_COLUMNS} FROM people WHERE account_id IS NOT NULL`)
    .all() as any[];
  const counts = new Map<number, { people: number; pulled: number }>();
  for (const p of people) {
    const c = counts.get(p.account_id) ?? { people: 0, pulled: 0 };
    c.people++;
    if (eligibility(p, rules).eligible) c.pulled++;
    counts.set(p.account_id, c);
  }
  const accounts = (db
    .prepare(
      `SELECT a.id, a.name, a.tier, a.website, a.size, a.industry, a.stage, a.pull_mode, a.notion_id, a.owner_id, u.name AS owner_name
       FROM accounts a LEFT JOIN users u ON u.id = a.owner_id ORDER BY a.name COLLATE NOCASE`,
    )
    .all() as any[]).map((a) => ({
    id: a.id,
    name: a.name,
    tier: a.tier,
    website: a.website,
    size: a.size,
    industry: a.industry,
    stage: a.stage,
    pullMode: a.pull_mode,
    owner: a.owner_id ? { id: a.owner_id, name: a.owner_name } : null,
    notionUrl: a.notion_id ? `https://www.notion.so/${a.notion_id}` : null,
    people: counts.get(a.id)?.people ?? 0,
    pulled: counts.get(a.id)?.pulled ?? 0,
  }));
  res.json({ accounts });
});

accountsRouter.patch('/:id', requireAdmin, (req, res) => {
  const body = z
    .object({ ownerId: z.number().int().nullable().optional(), pullMode: z.enum(['auto', 'always', 'never']).optional() })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid request' });
  const id = Number(req.params.id);
  const current = db.prepare('SELECT owner_id, pull_mode FROM accounts WHERE id = ?').get(id) as any;
  if (!current) return res.status(404).json({ error: 'Not found' });
  const ownerChanged = body.data.ownerId !== undefined && body.data.ownerId !== current.owner_id;
  db.prepare('UPDATE accounts SET owner_id = ?, pull_mode = ?, notion_dirty = notion_dirty OR (? AND notion_id IS NOT NULL) WHERE id = ?').run(
    body.data.ownerId === undefined ? current.owner_id : body.data.ownerId,
    body.data.pullMode ?? current.pull_mode,
    Number(ownerChanged),
    id,
  );
  if (ownerChanged) requestNotionSync();
  res.json({ ok: true });
});
