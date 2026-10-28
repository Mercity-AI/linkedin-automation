import { Router } from 'express';
import { z } from 'zod';
import { db, nowIso } from '../db.ts';
import {
  createSession,
  destroySession,
  findUserByEmail,
  hashPassword,
  publicUser,
  requireAuth,
  verifyPassword,
} from '../auth.ts';

export const authRouter = Router();

// Small in-memory throttle so the login form can't be brute-forced.
const attempts = new Map<string, { n: number; until: number }>();

authRouter.post('/login', (req, res) => {
  const body = z.object({ email: z.string().trim().min(1), password: z.string().min(1) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Enter your email and password.' });
  const key = `${req.ip}:${body.data.email.toLowerCase()}`;
  const a = attempts.get(key);
  if (a && a.n >= 8 && a.until > Date.now()) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  }
  const user = findUserByEmail(body.data.email);
  if (!user || !user.active || !verifyPassword(body.data.password, user.password_hash)) {
    attempts.set(key, { n: (a?.n ?? 0) + 1, until: Date.now() + 10 * 60_000 });
    return res.status(401).json({ error: 'That email and password don’t match.' });
  }
  attempts.delete(key);
  createSession(res, user.id);
  res.json({ user: publicUser({ ...user, last_login_at: nowIso() }) });
});

authRouter.post('/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});

authRouter.post('/password', requireAuth, (req, res) => {
  const body = z.object({ current: z.string().min(1), next: z.string().min(10) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'New password must be at least 10 characters.' });
  const user = findUserByEmail(req.user!.email)!;
  if (!verifyPassword(body.data.current, user.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }
  db.prepare('UPDATE users SET password_hash = ?, password_set_at = ? WHERE id = ?').run(
    hashPassword(body.data.next),
    nowIso(),
    user.id,
  );
  res.json({ ok: true });
});
