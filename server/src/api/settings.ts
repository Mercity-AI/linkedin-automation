import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth.ts';
import { BrightDataError, getBalance } from '../brightdata.ts';
import { db } from '../db.ts';
import { setPullRules, pullSummary } from '../pulls.ts';
import { AUTO_PULL_CHOICES, autoPullStatus, setAutoPull } from '../sync.ts';

export const settingsRouter = Router();

settingsRouter.get('/', (_req, res) => {
  res.json({ autoPull: autoPullStatus() });
});

/** The pull rules and who they cover. */
settingsRouter.get('/pull-rules', (_req, res) => res.json(pullSummary()));

settingsRouter.put('/pull-rules', requireAdmin, (req, res) => {
  const body = z
    .object({
      includeDisqualified: z.boolean(),
      onlyOwnedCompanies: z.boolean(),
      tiers: z.array(z.enum(['A', 'B', 'C', 'none'])),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid rules' });
  setPullRules(body.data);
  res.json(pullSummary());
});

settingsRouter.patch('/', requireAdmin, (req, res) => {
  const body = z
    .object({
      autoPullHours: z
        .number()
        .refine((n) => (AUTO_PULL_CHOICES as readonly number[]).includes(n))
        .optional(),
      /** Time of day in India (IST), "HH:MM". */
      autoPullAt: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .optional(),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid schedule' });
  const current = autoPullStatus();
  setAutoPull(body.data.autoPullHours ?? current.hours, body.data.autoPullAt ?? current.at);
  res.json({ autoPull: autoPullStatus() });
});

/** Bright Data balance plus what Pulse pulled this month. Cached for 5 minutes; ?refresh=1 skips the cache. */
let account: { at: number; value: unknown } | null = null;

settingsRouter.get('/brightdata', requireAdmin, async (req, res) => {
  if (!account || req.query.refresh === '1' || Date.now() - account.at > 5 * 60_000) {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const { records } = db
      .prepare('SELECT COALESCE(SUM(rc.records), 0) AS records FROM sync_run_contacts rc JOIN sync_runs r ON r.id = rc.run_id WHERE r.created_at >= ?')
      .get(monthStart) as { records: number };
    const usage = { recordsThisMonth: records };
    let value;
    try {
      value = { ok: true, ...(await getBalance()), usage, checkedAt: now.toISOString() };
    } catch (e) {
      const status = e instanceof BrightDataError ? e.status : undefined;
      value = { ok: false, reason: status === 401 || status === 403 ? 'permission' : 'error', error: (e as Error).message, usage, checkedAt: now.toISOString() };
    }
    account = { at: Date.now(), value };
  }
  res.json(account.value);
});
