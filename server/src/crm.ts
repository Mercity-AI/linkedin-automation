/**
 * Applies the Notion ABM CRM (Accounts, Contacts, Activities) to Pulse's database.
 * Used by the live Notion sync and by the snapshot import scripts, so both follow the same rules:
 *  - accounts and activities match on their Notion id; people on Notion id, then LinkedIn handle;
 *  - Notion is the source of truth for CRM fields, but an owner already set in Pulse is kept;
 *  - Notion owners map to Pulse users by email (missing teammates get an account with no usable password);
 *  - people without a LinkedIn URL are skipped, since there's nothing to track.
 */
import crypto from 'node:crypto';
import { hashPassword } from './auth.ts';
import { db } from './db.ts';
import { profileSlug, profileUrl } from './linkedin.ts';

export interface AccountIn {
  notionId: string;
  name: string;
  owner?: { email: string; name: string } | null;
  website: string | null;
  tier: string | null;
  size: string | null;
  industry: string | null;
  stage: string | null;
  whyNow: string | null;
}

export interface ContactIn {
  notionId: string;
  name: string;
  role: string | null;
  linkedin: string | null; // handle or URL
  accountNotionId: string | null;
  persona: string | null;
  region: string | null;
  location: string | null;
  campaign: string | null;
  connection: string | null;
  qualification: string | null;
  owner: { email: string; name: string } | null;
}

export interface ActivityIn {
  notionId: string;
  title: string | null;
  date: string | null; // YYYY-MM-DD or ISO
  contactNotionId: string | null;
  owner: { email: string; name: string } | null;
  channel: string | null;
  touchType: string | null;
  outcome: string | null;
  notes: string | null;
}

export interface CrmStats {
  accounts: { added: number; updated: number };
  people: { added: number; updated: number; ownersSet: number; skipped: string[] };
  activities: { added: number; updated: number; removed: number; skipped: number; linkedToPost: number; postsMarkedReplied: number };
  teammatesCreated: string[];
}

export const normalizeId = (id: string) => id.replace(/-/g, '').toLowerCase();

function userFor(owner: { email: string; name: string } | null, stats: CrmStats): number | null {
  if (!owner?.email) return null;
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(owner.email) as { id: number } | undefined;
  if (existing) return existing.id;
  const name = owner.name?.trim() || owner.email.split('@')[0]!.replace(/^\w/, (c) => c.toUpperCase());
  const { id } = db
    .prepare("INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, 'member', ?) RETURNING id")
    .get(owner.email, name, hashPassword(crypto.randomBytes(24).toString('base64url'))) as { id: number };
  stats.teammatesCreated.push(`${name} <${owner.email}>`);
  return id;
}

// Notion leaves Touch Type / Channel blank on a few rows; recover them from the title.
const touchTypeOf = (title: string, given: string | null) =>
  given ?? (/comment/i.test(title) ? 'Comment' : /quote|repost/i.test(title) ? 'Post' : null);
const channelOf = (title: string, notes: string | null, given: string | null) =>
  given ?? (/\bon X\b|^X \(/.test(`${title} ${notes ?? ''}`) ? 'X' : null);
/** Drop the "Post: …" / "Logged in Pulse." footer the push adds (see notion.ts → notionNotes). */
const stripPulseFooter = (notes: string | null) =>
  notes?.includes('Logged in Pulse.') ? notes.replace(/(\n?Post: \S+)?\n?Logged in Pulse\.\s*$/, '').trim() || null : notes;

const postIdIn = (notes: string | null) => notes?.match(/(?:activity[:-]|share-)(\d{16,})/)?.[1] ?? null;

export function applyCrm(
  input: { accounts?: AccountIn[]; contacts?: ContactIn[]; activities?: ActivityIn[] },
  opts: { removeMissingActivities?: boolean } = {},
): CrmStats {
  const stats: CrmStats = {
    accounts: { added: 0, updated: 0 },
    people: { added: 0, updated: 0, ownersSet: 0, skipped: [] },
    activities: { added: 0, updated: 0, removed: 0, skipped: 0, linkedToPost: 0, postsMarkedReplied: 0 },
    teammatesCreated: [],
  };
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get() as { id: number } | undefined;

  db.transaction(() => {
    // --- Accounts
    const accountIds = new Map<string, { id: number; name: string }>();
    for (const r of db.prepare('SELECT id, name, notion_id FROM accounts WHERE notion_id IS NOT NULL').all() as any[]) {
      accountIds.set(r.notion_id, { id: r.id, name: r.name });
    }
    const insertAccount = db.prepare(
      `INSERT INTO accounts (notion_id, name, website, tier, size, industry, stage, why_now, owner_id)
       VALUES (@notionId, @name, @website, @tier, @size, @industry, @stage, @whyNow, @ownerId) RETURNING id`,
    );
    const updateAccount = db.prepare(
      `UPDATE accounts SET name = @name, website = @website, tier = @tier, size = @size, industry = @industry,
         stage = @stage, why_now = @whyNow, owner_id = COALESCE(owner_id, @ownerId),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = @id`,
    );
    for (const raw of input.accounts ?? []) {
      const { owner, ...a } = raw;
      const notionId = normalizeId(a.notionId);
      const existing = accountIds.get(notionId);
      const ownerId = userFor(owner ?? null, stats);
      if (existing) {
        updateAccount.run({ ...a, notionId, ownerId, id: existing.id });
        accountIds.set(notionId, { id: existing.id, name: a.name });
        stats.accounts.updated++;
      } else {
        const { id } = insertAccount.get({ ...a, notionId, ownerId }) as { id: number };
        accountIds.set(notionId, { id, name: a.name });
        stats.accounts.added++;
      }
    }

    // --- People
    const byNotion = db.prepare('SELECT id, owner_id FROM contacts WHERE notion_id = ?');
    const bySlug = db.prepare('SELECT id, owner_id FROM contacts WHERE slug = ?');
    const insertContact = db.prepare(
      `INSERT INTO contacts (slug, linkedin_url, name, role, company, location, account_id, persona, region, campaign,
                             connection, qualification, notion_id, owner_id, created_by)
       VALUES (@slug, @url, @name, @role, @company, @location, @accountId, @persona, @region, @campaign,
               @connection, @qualification, @notionId, @ownerId, @createdBy)`,
    );
    // While Pulse has unsent changes for someone (notion_dirty), keep its owner/connection until they're pushed.
    const updateContact = db.prepare(
      `UPDATE contacts SET name = @name, role = @role, company = COALESCE(@company, company),
         location = COALESCE(@location, location), account_id = COALESCE(@accountId, account_id), persona = @persona,
         region = @region, campaign = @campaign, qualification = @qualification, notion_id = @notionId,
         connection = CASE WHEN notion_dirty = 1 THEN connection ELSE @connection END,
         owner_id = COALESCE(owner_id, @ownerId)
       WHERE id = @id`,
    );
    for (const c of input.contacts ?? []) {
      const notionId = normalizeId(c.notionId);
      const raw = c.linkedin?.trim();
      const slug = raw ? profileSlug(/linkedin\.com/i.test(raw) ? raw : `https://www.linkedin.com/in/${raw}`) : null;
      if (!slug) {
        stats.people.skipped.push(c.name);
        continue;
      }
      const account = c.accountNotionId ? accountIds.get(normalizeId(c.accountNotionId)) : undefined;
      const row = {
        slug,
        url: profileUrl(slug),
        name: c.name,
        role: c.role,
        company: account?.name ?? null,
        location: c.location && !/^not verified/i.test(c.location) ? c.location : null,
        accountId: account?.id ?? null,
        persona: c.persona,
        region: c.region,
        campaign: c.campaign,
        connection: c.connection,
        qualification: c.qualification,
        notionId,
        ownerId: userFor(c.owner, stats),
        createdBy: admin?.id ?? null,
      };
      const existing = (byNotion.get(notionId) ?? bySlug.get(slug)) as { id: number; owner_id: number | null } | undefined;
      if (existing) {
        updateContact.run({ ...row, id: existing.id });
        stats.people.updated++;
        if (!existing.owner_id && row.ownerId) stats.people.ownersSet++;
      } else {
        insertContact.run(row);
        stats.people.added++;
        if (row.ownerId) stats.people.ownersSet++;
      }
    }

    // --- Activities
    if (input.activities) {
      const contactBy = db.prepare('SELECT id FROM contacts WHERE notion_id = ?');
      const postBy = db.prepare('SELECT id FROM posts WHERE contact_id = ? AND li_id = ?');
      const exists = db.prepare('SELECT 1 FROM activities WHERE notion_id = ?');
      const upsert = db.prepare(`
        INSERT INTO activities (contact_id, post_id, user_id, title, channel, touch_type, outcome, notes, occurred_at, source, notion_id)
        VALUES (@contactId, @postId, @userId, @title, @channel, @touchType, @outcome, @notes, @occurredAt, 'notion', @notionId)
        ON CONFLICT (notion_id) DO UPDATE SET contact_id = excluded.contact_id, post_id = COALESCE(excluded.post_id, post_id),
          user_id = excluded.user_id, title = excluded.title, channel = excluded.channel, touch_type = excluded.touch_type,
          outcome = excluded.outcome, notes = excluded.notes,
          -- Keep the exact time for touches logged in Pulse; Notion only stores the day.
          occurred_at = CASE WHEN substr(occurred_at, 1, 10) = substr(excluded.occurred_at, 1, 10) THEN occurred_at ELSE excluded.occurred_at END`);
      const markReplied = db.prepare("UPDATE posts SET status = 'replied', handled_by = ?, handled_at = ? WHERE id = ? AND status = 'open'");
      const seen = new Set<string>();

      for (const a of input.activities) {
        const notionId = normalizeId(a.notionId);
        seen.add(notionId);
        const contact = a.contactNotionId ? (contactBy.get(normalizeId(a.contactNotionId)) as { id: number } | undefined) : undefined;
        if (!contact || !a.title || !a.date) {
          stats.activities.skipped++;
          continue;
        }
        const liId = postIdIn(a.notes);
        const post = liId ? (postBy.get(contact.id, liId) as { id: number } | undefined) : undefined;
        const type = touchTypeOf(a.title, a.touchType);
        const userId = userFor(a.owner, stats);
        const occurredAt = a.date.length > 10 ? new Date(a.date).toISOString() : new Date(`${a.date}T12:00:00Z`).toISOString();
        if (exists.get(notionId)) stats.activities.updated++;
        else stats.activities.added++;
        upsert.run({
          contactId: contact.id,
          postId: post?.id ?? null,
          userId,
          title: a.title,
          channel: channelOf(a.title, a.notes, a.channel),
          touchType: type,
          outcome: a.outcome,
          notes: stripPulseFooter(a.notes),
          occurredAt,
          notionId,
        });
        if (post) {
          stats.activities.linkedToPost++;
          if (type === 'Comment' && markReplied.run(userId, occurredAt, post.id).changes) stats.activities.postsMarkedReplied++;
        }
      }

      // Notion is the record: an activity deleted there goes away here too.
      if (opts.removeMissingActivities) {
        const known = db.prepare('SELECT id, notion_id FROM activities WHERE notion_id IS NOT NULL').all() as { id: number; notion_id: string }[];
        const del = db.prepare('DELETE FROM activities WHERE id = ?');
        for (const k of known) {
          if (!seen.has(k.notion_id)) {
            del.run(k.id);
            stats.activities.removed++;
          }
        }
      }
    }
  })();

  return stats;
}
