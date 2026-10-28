import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth.ts';
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
