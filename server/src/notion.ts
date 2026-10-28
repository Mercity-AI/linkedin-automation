/**
 * Two-way sync with the Notion "ABM CRM" (Accounts, Contacts, Activities), via an internal connection.
 *
 *  Pulse → Notion  touches logged in Pulse become Activities (linked to the Contact, with owner and notes);
 *                  owner, LinkedIn status and last-touch date changes on a person are written to their Contact.
 *  Notion → Pulse  accounts, people and activities are read back and applied (see crm.ts for the rules).
 *
 * Push runs first, so a round trip never undoes a change made in Pulse.
 */
import { applyCrm, normalizeId, type AccountIn, type ActivityIn, type ContactIn, type CrmStats } from './crm.ts';
import { db, getSetting, nowIso, setSetting } from './db.ts';

const API = 'https://api.notion.com/v1';
const VERSION = '2026-03-11';

export class NotionError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

const token = () => process.env.NOTION_TOKEN?.trim() || null;
const abmPageId = () => process.env.NOTION_ABM_PAGE_ID?.trim() || null;
export const notionConfigured = () => !!(token() && abmPageId());

// Notion allows ~3 requests/second per connection: space calls out and retry politely.
let chain: Promise<unknown> = Promise.resolve();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const run = async (): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${API}${path}`, {
        method: init.method ?? 'GET',
        headers: { Authorization: `Bearer ${token()}`, 'Notion-Version': VERSION, 'Content-Type': 'application/json' },
        body: init.body ? JSON.stringify(init.body) : undefined,
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        await sleep(Number(res.headers.get('retry-after')) * 1000 || 1000 * 2 ** attempt);
        continue;
      }
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new NotionError(`Notion ${res.status}: ${data.message ?? res.statusText}`, res.status);
      return data as T;
    }
  };
  const p = chain.then(run, run);
  chain = p.then(
    () => sleep(340),
    () => sleep(340),
  );
  return p;
}

// --- Discovery -------------------------------------------------------------------

interface Sources {
  accounts: string;
  contacts: string;
  activities: string;
}
let sourcesCache: Sources | null = null;

/** Find the three databases under the ABM CRM page and their data sources. */
export async function discover(): Promise<Sources> {
  if (sourcesCache) return sourcesCache;
  const children = await call<{ results: any[] }>(`/blocks/${abmPageId()}/children?page_size=100`);
  const found: Partial<Sources> = {};
  for (const b of children.results) {
    if (b.type !== 'child_database') continue;
    const key = ({ Accounts: 'accounts', Contacts: 'contacts', Activities: 'activities' } as const)[b.child_database.title as string];
    if (!key) continue;
    const database = await call<{ data_sources: { id: string }[] }>(`/databases/${b.id}`);
    if (database.data_sources?.[0]) found[key] = database.data_sources[0].id;
  }
  if (!found.accounts || !found.contacts || !found.activities) {
    throw new NotionError('Couldn’t find the Accounts, Contacts and Activities databases. Is the ABM CRM page shared with the connection?');
  }
  return (sourcesCache = found as Sources);
}

async function queryAll(dataSourceId: string) {
  const pages: any[] = [];
  let cursor: string | undefined;
  do {
    const res = await call<{ results: any[]; has_more: boolean; next_cursor: string | null }>(`/data_sources/${dataSourceId}/query`, {
      method: 'POST',
      body: { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) },
    });
    pages.push(...res.results);
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return pages;
}

// --- Property readers --------------------------------------------------------------

const prop = (page: any, name: string) => page.properties?.[name];
const text = (p: any) => {
  const parts = p?.title ?? p?.rich_text;
  const s = Array.isArray(parts) ? parts.map((t: any) => t.plain_text ?? '').join('').trim() : '';
  return s || null;
};
const select = (p: any) => p?.select?.name ?? p?.status?.name ?? null;
const url = (p: any) => p?.url ?? null;
const date = (p: any) => p?.date?.start ?? null;
const relation = (p: any): string | null => p?.relation?.[0]?.id ?? null;
const person = (p: any) => {
  const u = p?.people?.find((x: any) => x.person?.email);
  return u ? { email: String(u.person.email).toLowerCase(), name: u.name ?? '' } : null;
};

// --- Notion users ------------------------------------------------------------------

async function notionUserIdsByEmail() {
  const map = new Map<string, string>();
  let cursor: string | undefined;
  do {
    const res = await call<{ results: any[]; has_more: boolean; next_cursor: string | null }>(
      `/users?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`,
    );
    for (const u of res.results) if (u.type === 'person' && u.person?.email) map.set(String(u.person.email).toLowerCase(), u.id);
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return map;
}

// --- Push: Pulse → Notion ----------------------------------------------------------

const TOUCH_TITLES: Record<string, string> = {
  Comment: 'Comment',
  Post: 'Repost with thoughts',
  DM: 'Message',
  'Connect Request': 'Connect request',
  'Profile View': 'Profile view',
};

/** Notion caps a rich-text object at 2,000 characters. */
const richText = (s: string) =>
  (s.match(/[\s\S]{1,1900}/g) ?? []).map((content) => ({ type: 'text', text: { content } }));

/** What Pulse writes into a Notion Activity's Notes. stripPulseFooter() undoes the footer on the way back. */
export const notionNotes = (notes: string | null, postUrl: string | null) =>
  [notes, postUrl ? `Post: ${postUrl}` : null, 'Logged in Pulse.'].filter(Boolean).join('\n');

/** Move a page to Notion's trash (recoverable there for 30 days). A page that's already gone is fine. */
export async function trashNotionPage(pageId: string) {
  try {
    await call(`/pages/${pageId}`, { method: 'PATCH', body: { in_trash: true } });
  } catch (e) {
    if ((e as NotionError).status !== 404) throw e;
  }
}

export async function updateNotionActivity(
  pageId: string,
  a: { notes: string | null; postUrl: string | null; touchType: string | null; outcome: string | null },
) {
  await call(`/pages/${pageId}`, {
    method: 'PATCH',
    body: {
      properties: {
        Notes: { rich_text: richText(notionNotes(a.notes, a.postUrl)) },
        ...(a.touchType ? { 'Touch Type': { select: { name: a.touchType } } } : {}),
        ...(a.outcome ? { Outcome: { select: { name: a.outcome } } } : {}),
      },
    },
  });
}

interface PushStats {
  activitiesCreated: number;
  activitiesWaiting: number; // their person isn't in Notion
  contactsUpdated: number;
}

async function push(sources: Sources, notionUsers: Map<string, string>): Promise<PushStats> {
  const stats: PushStats = { activitiesCreated: 0, activitiesWaiting: 0, contactsUpdated: 0 };

  const pending = db
    .prepare(
      `SELECT a.*, c.notion_id AS contact_notion_id, c.name AS contact_name, c.slug AS contact_slug,
              u.email AS user_email, p.url AS post_url
       FROM activities a JOIN contacts c ON c.id = a.contact_id
       LEFT JOIN users u ON u.id = a.user_id LEFT JOIN posts p ON p.id = a.post_id
       WHERE a.source = 'pulse' AND a.notion_id IS NULL ORDER BY a.occurred_at`,
    )
    .all() as any[];

  for (const a of pending) {
    if (!a.contact_notion_id) {
      stats.activitiesWaiting++;
      continue;
    }
    const ownerId = a.user_email ? notionUsers.get(a.user_email.toLowerCase()) : undefined;
    const notes = notionNotes(a.notes, a.post_url);
    const page = await call<{ id: string }>('/pages', {
      method: 'POST',
      body: {
        parent: { type: 'data_source_id', data_source_id: sources.activities },
        properties: {
          Touch: { title: [{ type: 'text', text: { content: `${TOUCH_TITLES[a.touch_type] ?? a.touch_type ?? 'Touch'}, ${a.contact_name ?? a.contact_slug}` } }] },
          Channel: { select: { name: a.channel ?? 'LinkedIn' } },
          ...(a.touch_type ? { 'Touch Type': { select: { name: a.touch_type } } } : {}),
          ...(a.outcome ? { Outcome: { select: { name: a.outcome } } } : {}),
          Date: { date: { start: String(a.occurred_at).slice(0, 10) } },
          Contact: { relation: [{ id: a.contact_notion_id }] },
          ...(ownerId ? { Owner: { people: [{ id: ownerId }] } } : {}),
          Notes: { rich_text: richText(notes) },
        },
      },
    });
    db.prepare('UPDATE activities SET notion_id = ? WHERE id = ?').run(normalizeId(page.id), a.id);
    db.prepare('UPDATE contacts SET notion_dirty = 1 WHERE id = ?').run(a.contact_id); // bump Last Touch Date
    stats.activitiesCreated++;
  }

  const dirty = db
    .prepare(
      `SELECT c.id, c.notion_id, c.connection, u.email AS owner_email,
              (SELECT MAX(occurred_at) FROM activities a WHERE a.contact_id = c.id) AS last_touch
       FROM contacts c LEFT JOIN users u ON u.id = c.owner_id
       WHERE c.notion_dirty = 1 AND c.notion_id IS NOT NULL`,
    )
    .all() as any[];
  for (const c of dirty) {
    const ownerId = c.owner_email ? notionUsers.get(c.owner_email.toLowerCase()) : undefined;
    await call(`/pages/${c.notion_id}`, {
      method: 'PATCH',
      body: {
        properties: {
          Owner: { people: ownerId ? [{ id: ownerId }] : [] },
          'LinkedIn Status': { select: c.connection ? { name: c.connection } : null },
          // No touches left (the last one was deleted) clears the date too.
          'Last Touch Date': { date: c.last_touch ? { start: String(c.last_touch).slice(0, 10) } : null },
        },
      },
    });
    db.prepare('UPDATE contacts SET notion_dirty = 0 WHERE id = ?').run(c.id);
    stats.contactsUpdated++;
  }
  const dirtyAccounts = db
    .prepare(
      `SELECT a.id, a.notion_id, u.email AS owner_email FROM accounts a LEFT JOIN users u ON u.id = a.owner_id
       WHERE a.notion_dirty = 1 AND a.notion_id IS NOT NULL`,
    )
    .all() as any[];
  for (const a of dirtyAccounts) {
    const ownerId = a.owner_email ? notionUsers.get(a.owner_email.toLowerCase()) : undefined;
    await call(`/pages/${a.notion_id}`, { method: 'PATCH', body: { properties: { Owner: { people: ownerId ? [{ id: ownerId }] : [] } } } });
    db.prepare('UPDATE accounts SET notion_dirty = 0 WHERE id = ?').run(a.id);
    stats.contactsUpdated++;
  }

  // People who only exist in Pulse can't be written to Notion; don't keep them queued.
  db.prepare('UPDATE contacts SET notion_dirty = 0 WHERE notion_dirty = 1 AND notion_id IS NULL').run();
  return stats;
}

// --- Pull: Notion → Pulse ----------------------------------------------------------

async function pull(sources: Sources): Promise<CrmStats> {
  const [accountPages, contactPages, activityPages] = [
    await queryAll(sources.accounts),
    await queryAll(sources.contacts),
    await queryAll(sources.activities),
  ];
  const accounts: AccountIn[] = accountPages.map((p) => ({
    notionId: p.id,
    name: text(prop(p, 'Company Name')) ?? 'Untitled company',
    website: url(prop(p, 'Website')),
    tier: select(prop(p, 'Tier')),
    size: select(prop(p, 'Company Size')),
    industry: select(prop(p, 'Industry')),
    stage: select(prop(p, 'Status')),
    whyNow: text(prop(p, 'Trigger Event / Why Now')),
    owner: person(prop(p, 'Owner')),
  }));
  const contacts: ContactIn[] = contactPages.map((p) => ({
    notionId: p.id,
    name: text(prop(p, 'Name')) ?? 'Unnamed',
    role: text(prop(p, 'Role/Title')),
    linkedin: url(prop(p, 'LinkedIn URL')),
    accountNotionId: relation(prop(p, 'Account')),
    persona: select(prop(p, 'Persona')),
    region: select(prop(p, 'Region')),
    location: text(prop(p, 'Location')),
    campaign: select(prop(p, 'Campaign')),
    connection: select(prop(p, 'LinkedIn Status')),
    qualification: select(prop(p, 'Qualification')),
    owner: person(prop(p, 'Owner')),
  }));
  const activities: ActivityIn[] = activityPages.map((p) => ({
    notionId: p.id,
    title: text(prop(p, 'Touch')),
    date: date(prop(p, 'Date')) ?? p.created_time?.slice(0, 10) ?? null,
    contactNotionId: relation(prop(p, 'Contact')),
    owner: person(prop(p, 'Owner')),
    channel: select(prop(p, 'Channel')),
    touchType: select(prop(p, 'Touch Type')),
    outcome: select(prop(p, 'Outcome')),
    notes: text(prop(p, 'Notes')),
  }));
  return applyCrm({ accounts, contacts, activities }, { removeMissingActivities: true });
}

// --- Orchestration -----------------------------------------------------------------

export interface SyncResult {
  startedAt: string;
  finishedAt: string;
  trigger: 'auto' | 'manual';
  by: string | null;
  ok: boolean;
  error?: string;
  pushed?: PushStats;
  pulled?: CrmStats;
}

let running: Promise<SyncResult> | null = null;
export const notionSyncRunning = () => !!running;

export function syncNotion(trigger: 'auto' | 'manual', by: string | null = null): Promise<SyncResult> {
  if (running) return running;
  running = (async () => {
    const startedAt = nowIso();
    let result: SyncResult;
    try {
      if (!notionConfigured()) throw new NotionError('NOTION_TOKEN and NOTION_ABM_PAGE_ID aren’t set.');
      const sources = await discover();
      const users = await notionUserIdsByEmail();
      const pushed = await push(sources, users);
      const pulled = await pull(sources);
      result = { startedAt, finishedAt: nowIso(), trigger, by, ok: true, pushed, pulled };
    } catch (e) {
      sourcesCache = null;
      result = { startedAt, finishedAt: nowIso(), trigger, by, ok: false, error: (e as Error).message };
      console.warn(`[notion] sync failed: ${(e as Error).message}`);
    }
    setSetting('notion_last_sync', JSON.stringify(result));
    return result;
  })().finally(() => {
    running = null;
  });
  return running;
}

export function notionSyncStatus() {
  const hours = Number(getSetting('notion_sync_hours') ?? 12);
  const last = JSON.parse(getSetting('notion_last_sync') ?? 'null') as SyncResult | null;
  const pending = (db.prepare("SELECT COUNT(*) n FROM activities WHERE source = 'pulse' AND notion_id IS NULL").get() as { n: number }).n;
  return {
    configured: notionConfigured(),
    hours,
    running: notionSyncRunning(),
    last,
    nextAt: hours && last ? new Date(Date.parse(last.startedAt) + hours * 3600_000).toISOString() : null,
    pendingActivities: pending,
  };
}

export async function notionConnectionInfo() {
  if (!notionConfigured()) return { configured: false as const };
  try {
    const me = await call<{ name: string; bot?: { workspace_name?: string } }>('/users/me');
    const sources = await discover();
    return { configured: true as const, ok: true as const, name: me.name, workspace: me.bot?.workspace_name ?? null, sources };
  } catch (e) {
    return { configured: true as const, ok: false as const, error: (e as Error).message };
  }
}

/** Changes made in Pulse go out shortly after they happen, batched over ~20 seconds. */
let pending: ReturnType<typeof setTimeout> | null = null;
export function requestNotionSync() {
  if (!notionConfigured()) return;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    void syncNotion('auto');
  }, 20_000);
}

/** Called every few minutes by the poller. */
export async function autoNotionSync() {
  const { configured, hours, last } = notionSyncStatus();
  if (!configured || !hours) return;
  if (last && Date.now() - Date.parse(last.startedAt) < hours * 3600_000) return;
  await syncNotion('auto');
}
