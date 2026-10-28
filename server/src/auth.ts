import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db, nowIso } from './db.ts';

export const SESSION_COOKIE = 'pulse_session';
const SESSION_DAYS = 30;

export type Role = 'admin' | 'member';
export interface User {
  id: number;
  email: string;
  name: string;
  title: string | null;
  role: Role;
  active: number;
  created_at: string;
  password_set_at: string;
  last_login_at: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const USER_COLUMNS = 'id, email, name, title, role, active, created_at, password_set_at, last_login_at';

export const hashPassword = (plain: string) => bcrypt.hashSync(plain, 11);

// Unambiguous characters only (no 0/O, 1/l/I), grouped so it's easy to read out loud.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generatePassword() {
  const bytes = crypto.randomBytes(15);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return [chars.slice(0, 5), chars.slice(5, 10), chars.slice(10, 15)].map((g) => g.join('')).join('-');
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function findUserByEmail(email: string) {
  return db.prepare(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = ?`).get(email) as
    | (User & { password_hash: string })
    | undefined;
}

export function getUser(id: number) {
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id) as User | undefined;
}

export function verifyPassword(plain: string, hash: string) {
  return bcrypt.compareSync(plain, hash);
}

export function createSession(res: Response, userId: number) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    sha256(token),
    userId,
    expires.toISOString(),
  );
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), userId);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
    expires,
    path: '/',
  });
}

export function destroySession(req: Request, res: Response) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function revokeSessions(userId: number) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    const row = db
      .prepare(
        `SELECT u.${USER_COLUMNS.split(', ').join(', u.')}
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
      )
      .get(sha256(token), nowIso()) as User | undefined;
    if (row) req.user = row;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  next();
}

export function publicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    title: u.title,
    role: u.role,
    active: !!u.active,
    createdAt: u.created_at,
    passwordSetAt: u.password_set_at,
    lastLoginAt: u.last_login_at,
  };
}

/** First boot: create the owner account from ADMIN_EMAIL / ADMIN_PASSWORD. */
export function ensureAdmin() {
  const count = (db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n;
  if (count > 0) return;
  const email = process.env.ADMIN_EMAIL ?? 'pranav@mercity.io';
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.warn('[auth] No users and no ADMIN_PASSWORD set — cannot create the owner account.');
    return;
  }
  db.prepare("INSERT INTO users (email, name, role, title, password_hash) VALUES (?, ?, 'admin', ?, ?)").run(
    email,
    process.env.ADMIN_NAME ?? 'Pranav',
    'Owner',
    hashPassword(password),
  );
  console.log(`[auth] Created owner account ${email}`);
}
