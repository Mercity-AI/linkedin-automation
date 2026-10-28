import { db, getSetting, nowIso, setSetting } from './db.ts';
import * as bd from './brightdata.ts';
import { cleanUrl, profileSlug, profileUrl } from './linkedin.ts';
import { autoNotionSync, notionConfigured, syncNotion } from './notion.ts';
import { ELIGIBILITY_COLUMNS, eligibility, getPullRules, idsForScope, type EligibilityInput } from './pulls.ts';

type Row = Record<string, any>;
interface ContactRef extends EligibilityInput {
  id: number;
  slug: string;
}
interface RunRow {
  id: number;
  kind: 'posts' | 'profile';
  snapshot_id: string;
  status: string;
  created_at: string;
}

const POLL_MS = 8_000;
const RUN_TIMEOUT_MS = 60 * 60_000;

function loadContacts(ids: number[]): ContactRef[] {
  if (!ids.length) return [];
  return db
    .prepare(`SELECT id, slug, ${ELIGIBILITY_COLUMNS} FROM people WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as ContactRef[];
}

function createRun(kind: RunRow['kind'], snapshotId: string, contacts: ContactRef[], userId: number | null, range?: DateRange) {
  return db.transaction(() => {
    const { id } = db
      .prepare(
        'INSERT INTO sync_runs (kind, snapshot_id, start_date, end_date, requested_by) VALUES (?, ?, ?, ?, ?) RETURNING id',
      )
      .get(kind, snapshotId, range?.start ?? null, range?.end ?? null, userId) as { id: number };
    const link = db.prepare('INSERT INTO sync_run_contacts (run_id, contact_id) VALUES (?, ?)');
    for (const c of contacts) link.run(id, c.id);
    return id;
  })();
}

export interface DateRange {
  start?: string; // YYYY-MM-DD
  end?: string; // YYYY-MM-DD
}

/** True if any of these contacts already has a run of this kind in flight. */
function busy(kind: RunRow['kind'], ids: number[]) {
  return db
    .prepare(
      `SELECT DISTINCT rc.contact_id id FROM sync_run_contacts rc JOIN sync_runs r ON r.id = rc.run_id
       WHERE r.status = 'running' AND r.kind = ? AND rc.contact_id IN (${ids.map(() => '?').join(',')})`,
    )
    .all(kind, ...ids)
    .map((r: any) => r.id as number);
}

export async function startPostsSync(contactIds: number[], range: DateRange, userId: number | null) {
  const inFlight = new Set(busy('posts', contactIds));
  const loaded = loadContacts(contactIds);
  // Every pull, even of people picked by hand, only reaches those the pull rules cover.
  const rules = getPullRules();
  const allowed = loaded.filter((c) => eligibility(c, rules).eligible);
  const excluded = loaded.length - allowed.length;
  const contacts = allowed.filter((c) => !inFlight.has(c.id));
  if (!contacts.length) return { runId: null, skipped: inFlight.size, excluded };
  const { snapshot_id } = await bd.triggerPostsDiscovery(
    contacts.map((c) => ({
      url: profileUrl(c.slug),
      only_authored_posts: false, // we want reposts too
      ...(range.start ? { start_date: `${range.start}T00:00:00.000Z` } : {}),
      ...(range.end ? { end_date: `${range.end}T23:59:59.999Z` } : {}),
    })),
  );
  const runId = createRun('posts', snapshot_id, contacts, userId, range);
  setTimeout(tick, 1500);
  return { runId, skipped: inFlight.size, excluded };
}

export async function startProfileSync(contactIds: number[], userId: number | null) {
  const inFlight = new Set(busy('profile', contactIds));
  const contacts = loadContacts(contactIds).filter((c) => !inFlight.has(c.id));
  if (!contacts.length) return { runId: null };
  const { snapshot_id } = await bd.triggerProfiles(contacts.map((c) => profileUrl(c.slug)));
  return { runId: createRun('profile', snapshot_id, contacts, userId) };
}

// ---------------------------------------------------------------------------
// Ingest

function sourceSlug(row: Row): string | null {
  return profileSlug(row.discovery_input?.url ?? row.input?.url ?? row.input_url ?? '') ?? null;
}

function liId(row: Row): string | null {
  if (row.id) return String(row.id);
  const m = String(row.url ?? '').match(/activity[-:](\d{10,})/);
  return m ? m[1] : null;
}

const arr = (v: unknown) => (Array.isArray(v) ? v.filter(Boolean) : []);

/** LinkedIn serves a generic grey silhouette from static.licdn.com when someone has no photo; treat it as no photo. */
const photo = (...urls: unknown[]) =>
  (urls.find((u) => typeof u === 'string' && u && !u.includes('static.licdn.com')) as string | undefined) ?? null;

function mediaOf(row: Row) {
  const link = arr(row.external_link_data)[0];
  return JSON.stringify({
    images: arr(row.images),
    videos: arr(row.videos),
    videoThumb: row.video_thumbnail || null,
    videoDuration: row.video_duration ?? null,
    document: row.document_cover_image
      ? { cover: row.document_cover_image, pages: row.document_page_count ?? null }
      : null,
    link: link
      ? {
          url: cleanUrl(link.post_external_url),
          title: link.post_external_title ?? null,
          description: link.post_external_description ?? null,
          image: link.post_external_image ?? null,
        }
      : null,
  });
}

function originalOf(row: Row) {
  const r = row.repost;
  if (!r || !(r.repost_url || r.repost_text)) return null;
  return JSON.stringify({
    url: cleanUrl(r.repost_url),
    id: r.repost_id ?? null,
    authorSlug: r.repost_user_id ?? null,
    authorName: r.repost_user_name ?? null,
    text: r.repost_text ?? null,
    date: r.repost_date ?? null,
  });
}

function commentsOf(row: Row) {
  return JSON.stringify(
    arr(row.top_visible_comments)
      .slice(0, 8)
      .map((c: Row) => ({
        name: c.user_name ?? null,
        slug: c.user_id ?? null,
        url: cleanUrl(c.use_url),
        text: c.comment ?? '',
        date: c.comment_date ?? null,
        likes: c.num_reactions ?? null,
        title: c.user_title ?? null,
        avatar: photo(c.user_profile_pic),
      })),
  );
}

/** Turn Bright Data's error rows into something a person can act on. */
function describeError(row: Row): string {
  const msg = String(row.error ?? '');
  const total = msg.match(/Total posts on page: (\d+)/)?.[1];
  if (/matching requested period[^:]*: 0/.test(msg)) {
    return total
      ? `No posts in that date range. LinkedIn's public feed for this person only reaches back ${total} posts.`
      : 'No posts in that date range.';
  }
  if (row.error_code === 'dead_page') return 'Profile not found or has no public activity.';
  if (/sign ?up|login|auth/i.test(msg)) return 'LinkedIn showed a sign-in wall for this profile.';
  return msg.slice(0, 240) || 'Unknown error from Bright Data.';
}

const upsertPost = () =>
  db.prepare(`
  INSERT INTO posts (contact_id, li_id, url, kind, author_slug, author_name, author_title, author_avatar, author_url,
                     title, text, posted_at, num_likes, num_comments, media, original, top_comments, raw)
  VALUES (@contact_id, @li_id, @url, @kind, @author_slug, @author_name, @author_title, @author_avatar, @author_url,
          @title, @text, @posted_at, @num_likes, @num_comments, @media, @original, @top_comments, @raw)
  ON CONFLICT (contact_id, li_id) DO UPDATE SET
    url = excluded.url, kind = excluded.kind,
    author_name = COALESCE(excluded.author_name, author_name),
    author_title = COALESCE(excluded.author_title, author_title),
    author_avatar = COALESCE(excluded.author_avatar, author_avatar),
    title = excluded.title, text = COALESCE(excluded.text, text),
    posted_at = COALESCE(excluded.posted_at, posted_at),
    num_likes = excluded.num_likes, num_comments = excluded.num_comments,
    media = excluded.media, original = COALESCE(excluded.original, original),
    top_comments = excluded.top_comments, raw = excluded.raw,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
`);

function ingestPosts(run: RunRow, rows: Row[]) {
  const contacts = db
    .prepare('SELECT c.id, c.slug FROM sync_run_contacts rc JOIN contacts c ON c.id = rc.contact_id WHERE rc.run_id = ?')
    .all(run.id) as ContactRef[];
  const bySlug = new Map(contacts.map((c) => [c.slug, c]));
  const stats = new Map(contacts.map((c) => [c.id, { records: 0, newPosts: 0, unreadable: 0, note: null as string | null }]));
  const upsert = upsertPost();
  const exists = db.prepare('SELECT 1 FROM posts WHERE contact_id = ? AND li_id = ?');
  const fillIdentity = db.prepare(`
    UPDATE contacts SET
      name = COALESCE(name, @name), headline = COALESCE(headline, @headline),
      avatar_url = COALESCE(avatar_url, @avatar), followers = COALESCE(@followers, followers)
    WHERE id = @id`);

  db.transaction(() => {
    for (const row of rows) {
      const contact = bySlug.get(sourceSlug(row) ?? '') ?? (contacts.length === 1 ? contacts[0] : undefined);
      if (!contact) continue;
      const s = stats.get(contact.id)!;
      if (row.error) {
        // Errors on an individual post (input is a post URL) vs. on the whole profile.
        if (row.discovery_input && row.input?.url && !profileSlug(row.input.url)) s.unreadable++;
        else s.note = describeError(row);
        continue;
      }
      const id = liId(row);
      if (!id || !row.url) continue;
      const author = String(row.user_id ?? '').toLowerCase();
      const kind = row.post_type === 'repost' ? 'quote' : author && author !== contact.slug ? 'repost' : 'post';
      const inserted = !exists.get(contact.id, id);
      upsert.run({
        contact_id: contact.id,
        li_id: id,
        url: cleanUrl(row.url),
        kind,
        author_slug: author || null,
        author_name: row.user_name ?? null,
        author_title: row.user_title ?? null,
        author_avatar: photo(row.author_profile_pic, row.user_profile_pic),
        author_url: cleanUrl(row.use_url),
        title: row.title ?? null,
        text: row.post_text ?? row.original_post_text ?? null,
        posted_at: row.date_posted ?? null,
        num_likes: row.num_likes ?? null,
        num_comments: row.num_comments ?? null,
        media: mediaOf(row),
        original: originalOf(row),
        top_comments: commentsOf(row),
        raw: JSON.stringify(row),
      });
      s.records++;
      if (inserted) s.newPosts++;
      if (kind !== 'repost') {
        fillIdentity.run({
          id: contact.id,
          name: row.user_name ?? null,
          headline: row.user_title ?? null,
          avatar: photo(row.user_profile_pic, row.author_profile_pic),
          followers: row.user_followers ?? null,
        });
      }
    }

    const now = nowIso();
    const saveStats = db.prepare(
      'UPDATE sync_run_contacts SET records = ?, new_posts = ?, note = ? WHERE run_id = ? AND contact_id = ?',
    );
    let records = 0;
    let newPosts = 0;
    for (const [contactId, s] of stats) {
      records += s.records;
      newPosts += s.newPosts;
      const note =
        s.note ??
        (s.unreadable ? `${s.unreadable} post${s.unreadable > 1 ? 's' : ''} hidden behind LinkedIn's sign-in wall.` : null);
      saveStats.run(s.records, s.newPosts, note, run.id, contactId);
      db.prepare('UPDATE contacts SET posts_synced_at = ? WHERE id = ?').run(now, contactId);
    }
    db.prepare("UPDATE sync_runs SET status = 'ready', finished_at = ?, records = ?, new_posts = ? WHERE id = ?").run(
      now,
      records,
      newPosts,
      run.id,
    );
  })();
}

function ingestProfiles(run: RunRow, rows: Row[]) {
  const contacts = db
    .prepare('SELECT c.id, c.slug FROM sync_run_contacts rc JOIN contacts c ON c.id = rc.contact_id WHERE rc.run_id = ?')
    .all(run.id) as ContactRef[];
  const bySlug = new Map(contacts.map((c) => [c.slug, c]));
  const update = db.prepare(`
    UPDATE contacts SET
      name = COALESCE(@name, name), headline = COALESCE(@headline, headline), company = CASE WHEN account_id IS NULL THEN COALESCE(@company, company) ELSE company END,
      location = COALESCE(@location, location), avatar_url = COALESCE(@avatar, avatar_url),
      followers = COALESCE(@followers, followers), profile_synced_at = @now
    WHERE id = @id`);
  const note = db.prepare('UPDATE sync_run_contacts SET records = ?, note = ? WHERE run_id = ? AND contact_id = ?');
  let records = 0;
  db.transaction(() => {
    for (const row of rows) {
      const slug = sourceSlug(row) ?? (row.linkedin_id ? String(row.linkedin_id).toLowerCase() : '');
      const contact = bySlug.get(slug) ?? (contacts.length === 1 ? contacts[0] : undefined);
      if (!contact) continue;
      if (row.error) {
        note.run(0, describeError(row), run.id, contact.id);
        continue;
      }
      records++;
      update.run({
        id: contact.id,
        name: row.name ?? ([row.first_name, row.last_name].filter(Boolean).join(' ') || null),
        headline: row.position ?? null,
        company: row.current_company?.name ?? row.current_company_name ?? null,
        location: row.city ?? row.location ?? null,
        avatar: row.default_avatar ? null : photo(row.avatar),
        followers: row.followers ?? null,
        now: nowIso(),
      });
      note.run(1, null, run.id, contact.id);
    }
    db.prepare("UPDATE sync_runs SET status = 'ready', finished_at = ?, records = ? WHERE id = ?").run(
      nowIso(),
      records,
      run.id,
    );
  })();
}

// ---------------------------------------------------------------------------
// Poller — resumes any run left 'running' across restarts.

function failRun(run: RunRow, error: string) {
  db.prepare("UPDATE sync_runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?").run(
    nowIso(),
    error.slice(0, 500),
    run.id,
  );
}

async function checkRun(run: RunRow) {
  try {
    const p = await bd.getProgress(run.snapshot_id);
    if (p.status === 'ready') {
      const rows = await bd.getSnapshot<Row>(run.snapshot_id);
      if (!Array.isArray(rows)) return; // snapshot still being built; try next tick
      if (run.kind === 'posts') ingestPosts(run, rows);
      else ingestProfiles(run, rows);
    } else if (p.status === 'failed') {
      failRun(run, `Bright Data reported the job failed${p.error_codes ? ` (${Object.keys(p.error_codes).join(', ')})` : ''}.`);
    } else if (Date.now() - Date.parse(run.created_at) > RUN_TIMEOUT_MS) {
      failRun(run, 'Timed out after 60 minutes waiting for Bright Data.');
    }
  } catch (err) {
    const e = err as bd.BrightDataError;
    if (e.status === 404 || e.status === 400) failRun(run, e.message);
    else console.warn(`[sync] run ${run.id}: ${e.message}`);
  }
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const runs = db.prepare("SELECT id, kind, snapshot_id, status, created_at FROM sync_runs WHERE status = 'running'").all() as RunRow[];
    await Promise.all(runs.map(checkRun));
  } finally {
    ticking = false;
  }
}

// ---------------------------------------------------------------------------
// Automatic pulls. Bright Data only sees roughly the latest 10 items on a profile's public
// activity feed, so regular pulls are how history accumulates here.

export const AUTO_PULL_CHOICES = [0, 6, 12, 24, 48] as const;

/** India Standard Time is UTC+5:30 all year (no daylight saving). */
const IST_OFFSET_MS = 330 * 60_000;

/** The next moment after `from` when it's `at` ("HH:MM") in India. */
function nextIstTime(at: string, from: number) {
  const [h, m] = at.split(':').map(Number);
  const ist = new Date(from + IST_OFFSET_MS); // IST wall clock, read through the UTC getters
  const t = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), h, m) - IST_OFFSET_MS;
  return t > from ? t : t + 864e5;
}

/**
 * Runs sit on a grid: every `hours`, lined up with `at` IST (every 6 hours at 09:00 means 03:00, 09:00, 15:00, 21:00).
 * The anchor is the first run after the schedule was saved, so earlier slots never fire.
 */
function firstRun(hours: number, at: string, from: number) {
  const t = nextIstTime(at, from);
  const period = hours * 3600_000;
  return t - (Math.ceil((t - from) / period) - 1) * period;
}

export function setAutoPull(hours: number, at: string) {
  setSetting('auto_pull_hours', String(hours));
  setSetting('auto_pull_at', at);
  setSetting('auto_pull_anchor', hours ? new Date(firstRun(hours, at, Date.now())).toISOString() : null);
}

export function autoPullStatus() {
  const hours = Number(getSetting('auto_pull_hours') ?? 0);
  const at = getSetting('auto_pull_at') ?? '09:00';
  const lastAt = getSetting('auto_pull_last_at');
  if (!hours) return { hours, at, lastAt, nextAt: null as string | null, due: false };
  let anchor = Date.parse(getSetting('auto_pull_anchor') ?? '');
  if (Number.isNaN(anchor)) {
    // Schedules saved before times existed: line them up with `at` from now on.
    anchor = firstRun(hours, at, Date.now());
    setSetting('auto_pull_anchor', new Date(anchor).toISOString());
  }
  const period = hours * 3600_000;
  const now = Date.now();
  if (now < anchor) return { hours, at, lastAt, nextAt: new Date(anchor).toISOString(), due: false };
  const latest = anchor + Math.floor((now - anchor) / period) * period;
  // A run missed while the server was off still happens when it's back, unless the next one is closer.
  const due = (!lastAt || Date.parse(lastAt) < latest) && now - latest < period / 2;
  return { hours, at, lastAt, nextAt: new Date(due ? latest : latest + period).toISOString(), due };
}

/** Sync with Notion first, so people just added to the ABM CRM are part of the pull. */
export async function refreshFromNotion(trigger: 'auto' | 'manual', by: string | null = null) {
  if (!notionConfigured()) return null;
  const r = await syncNotion(trigger, by);
  return { ok: r.ok, newPeople: r.pulled?.people.added ?? 0, error: r.error ?? null };
}

async function autoPull() {
  if (!autoPullStatus().due) return;
  setSetting('auto_pull_last_at', nowIso());
  await refreshFromNotion('auto');
  const ids = idsForScope('eligible');
  if (!ids.length) return;
  try {
    const { runId } = await startPostsSync(ids, {}, null);
    console.log(`[sync] automatic pull started for ${ids.length} people (run ${runId})`);
  } catch (e) {
    console.warn(`[sync] automatic pull failed: ${(e as Error).message}`);
  }
}

export function startPoller() {
  setInterval(tick, POLL_MS);
  setInterval(autoPull, 60_000);
  setInterval(() => void autoNotionSync(), 5 * 60_000);
  tick();
  autoPull();
  setTimeout(() => void autoNotionSync(), 10_000);
}
