import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import './db.ts';
import { attachUser, ensureAdmin, requireAuth } from './auth.ts';
import { authRouter } from './api/auth.ts';
import { contactsRouter } from './api/contacts.ts';
import { overviewRouter } from './api/overview.ts';
import { accountsRouter } from './api/accounts.ts';
import { activitiesRouter } from './api/activities.ts';
import { brainRouter } from './api/brain.ts';
import { listRouter } from './api/list.ts';
import { notionRouter } from './api/notion.ts';
import { postsRouter } from './api/posts.ts';
import { settingsRouter } from './api/settings.ts';
import { syncsRouter } from './api/syncs.ts';
import { usersRouter } from './api/users.ts';
import { BrightDataError } from './brightdata.ts';
import { startPoller } from './sync.ts';

ensureAdmin();

const app = express();
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(attachUser);

app.use('/api/auth', authRouter);
app.use('/api/users', requireAuth, usersRouter);
app.use('/api/contacts', requireAuth, contactsRouter);
app.use('/api/posts', requireAuth, postsRouter);
app.use('/api/list', requireAuth, listRouter);
app.use('/api/overview', requireAuth, overviewRouter);
app.use('/api/syncs', requireAuth, syncsRouter);
app.use('/api/settings', requireAuth, settingsRouter);
app.use('/api/notion', requireAuth, notionRouter);
app.use('/api/brain', requireAuth, brainRouter);
app.use('/api/activities', requireAuth, activitiesRouter);
app.use('/api/accounts', requireAuth, accountsRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// In production, serve the built web app from the same origin.
const dist = path.resolve(import.meta.dirname, '../../web/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof BrightDataError ? 502 : 500;
  console.error(err);
  res.status(status).json({ error: err.message || 'Something went wrong' });
});

const port = Number(process.env.API_PORT ?? 4848);
const host = process.env.HOST ?? '127.0.0.1';
app.listen(port, host, (err?: Error) => {
  if (err) {
    console.error(`[api] could not listen on port ${port}: ${err.message}`);
    process.exit(1);
  }
  console.log(`[api] listening on http://${host}:${port}`);
  startPoller();
});
