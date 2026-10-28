import { Router } from 'express';
import { db } from '../db.ts';

export const syncsRouter = Router();

syncsRouter.get('/', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const runs = db
    .prepare(
      `SELECT r.*, u.name AS requested_by_name,
              (SELECT COUNT(*) FROM sync_run_contacts rc WHERE rc.run_id = r.id) AS contact_count
       FROM sync_runs r LEFT JOIN users u ON u.id = r.requested_by
       ORDER BY r.created_at DESC LIMIT ?`,
    )
    .all(limit) as any[];
  const people = db.prepare(
    `SELECT c.id, c.name, c.slug, c.avatar_url, rc.records, rc.new_posts, rc.note
     FROM sync_run_contacts rc JOIN contacts c ON c.id = rc.contact_id WHERE rc.run_id = ? ORDER BY c.name LIMIT 50`,
  );
  res.json({
    runs: runs.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      snapshotId: r.snapshot_id,
      startDate: r.start_date,
      endDate: r.end_date,
      createdAt: r.created_at,
      finishedAt: r.finished_at,
      records: r.records,
      newPosts: r.new_posts,
      error: r.error,
      requestedBy: r.requested_by_name,
      contactCount: r.contact_count,
      contacts: (people.all(r.id) as any[]).map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        avatarUrl: c.avatar_url,
        records: c.records,
        newPosts: c.new_posts,
        note: c.note,
      })),
    })),
  });
});

/** Cheap endpoint the UI polls while something is running. */
syncsRouter.get('/active', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT r.id, r.kind, r.created_at, GROUP_CONCAT(rc.contact_id) AS ids
       FROM sync_runs r JOIN sync_run_contacts rc ON rc.run_id = r.id
       WHERE r.status = 'running' GROUP BY r.id`,
    )
    .all() as any[];
  res.json({
    active: rows.map((r) => ({ id: r.id, kind: r.kind, createdAt: r.created_at, contactIds: String(r.ids).split(',').map(Number) })),
  });
});
