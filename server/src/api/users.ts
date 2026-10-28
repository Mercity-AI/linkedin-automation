import { Router } from 'express';
import { z } from 'zod';
import { db, nowIso } from '../db.ts';
import {
  findUserByEmail,
  generatePassword,
  getUser,
  hashPassword,
  publicUser,
  requireAdmin,
  revokeSessions,
  type User,
} from '../auth.ts';

export const usersRouter = Router();

// Everyone signed in can see the team (for owner pickers); only admins change it.
usersRouter.get('/', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.title, u.role, u.active, u.created_at, u.password_set_at, u.last_login_at,
              (SELECT COUNT(*) FROM people c WHERE c.eff_owner_id = u.id) AS contacts,
              (SELECT COUNT(*) FROM posts p JOIN people c ON c.id = p.contact_id
                 WHERE c.eff_owner_id = u.id AND p.status = 'open') AS open_posts
       FROM users u ORDER BY u.active DESC, u.role = 'admin' DESC, u.name COLLATE NOCASE`,
    )
    .all() as (User & { contacts: number; open_posts: number })[];
  res.json({
    users: rows.map((u) => ({ ...publicUser(u), contacts: u.contacts, openPosts: u.open_posts })),
  });
});

const userInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  title: z.string().trim().max(80).optional().nullable(),
  role: z.enum(['admin', 'member']).default('member'),
});

usersRouter.post('/', requireAdmin, (req, res) => {
  const body = userInput.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.issues[0].message });
  if (findUserByEmail(body.data.email)) return res.status(409).json({ error: 'Someone with that email already exists.' });
  const password = generatePassword();
  const { id } = db
    .prepare('INSERT INTO users (email, name, title, role, password_hash) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .get(body.data.email, body.data.name, body.data.title || null, body.data.role, hashPassword(password)) as {
    id: number;
  };
  res.status(201).json({ user: publicUser(getUser(id)!), password });
});

usersRouter.patch('/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const target = getUser(id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  const body = userInput.partial().extend({ active: z.boolean().optional() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.issues[0].message });
  const d = body.data;
  if (id === req.user!.id && (d.role === 'member' || d.active === false)) {
    return res.status(400).json({ error: 'You can’t demote or deactivate yourself.' });
  }
  if (d.email && d.email !== target.email && findUserByEmail(d.email)) {
    return res.status(409).json({ error: 'Someone with that email already exists.' });
  }
  db.prepare(
    `UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email), title = ?, role = COALESCE(?, role),
       active = COALESCE(?, active) WHERE id = ?`,
  ).run(
    d.name ?? null,
    d.email ?? null,
    d.title === undefined ? target.title : d.title || null,
    d.role ?? null,
    d.active === undefined ? null : Number(d.active),
    id,
  );
  if (d.active === false) revokeSessions(id);
  res.json({ user: publicUser(getUser(id)!) });
});

usersRouter.post('/:id/reset-password', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!getUser(id)) return res.status(404).json({ error: 'User not found' });
  const password = generatePassword();
  db.prepare('UPDATE users SET password_hash = ?, password_set_at = ? WHERE id = ?').run(hashPassword(password), nowIso(), id);
  // Old sessions die with the old password — except the admin's own current one.
  if (id !== req.user!.id) revokeSessions(id);
  res.json({ password });
});

usersRouter.delete('/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) return res.status(400).json({ error: 'You can’t remove yourself.' });
  const info = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  if (!info.changes) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});
