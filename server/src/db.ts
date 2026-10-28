import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = path.resolve(process.env.DB_PATH ?? path.join(import.meta.dirname, '../../data/pulse.db'));
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const NOW = `(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

// Each entry runs once, in order. Append new migrations; never edit old ones.
const migrations: string[] = [
  `
  CREATE TABLE users (
    id              INTEGER PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name            TEXT NOT NULL,
    title           TEXT,
    role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
    password_hash   TEXT NOT NULL,
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT ${NOW},
    password_set_at TEXT NOT NULL DEFAULT ${NOW},
    last_login_at   TEXT
  );

  CREATE TABLE sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT ${NOW},
    expires_at  TEXT NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  -- People we track on LinkedIn.
  CREATE TABLE contacts (
    id             INTEGER PRIMARY KEY,
    slug           TEXT NOT NULL UNIQUE,
    linkedin_url   TEXT NOT NULL,
    name           TEXT,
    headline       TEXT,
    company        TEXT,
    location       TEXT,
    avatar_url     TEXT,
    followers      INTEGER,
    owner_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    notes          TEXT,
    created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at     TEXT NOT NULL DEFAULT ${NOW},
    profile_synced_at TEXT,
    posts_synced_at   TEXT
  );
  CREATE INDEX contacts_owner ON contacts(owner_id);

  -- kind: post (authored), quote (repost with their own commentary), repost (plain reshare of someone else's post)
  CREATE TABLE posts (
    id             INTEGER PRIMARY KEY,
    contact_id     INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    li_id          TEXT NOT NULL,
    url            TEXT NOT NULL,
    kind           TEXT NOT NULL CHECK (kind IN ('post','quote','repost')),
    author_slug    TEXT,
    author_name    TEXT,
    author_title   TEXT,
    author_avatar  TEXT,
    author_url     TEXT,
    title          TEXT,
    text           TEXT,
    posted_at      TEXT,
    num_likes      INTEGER,
    num_comments   INTEGER,
    media          TEXT,  -- JSON: { images, videos, videoThumb, document, link }
    original       TEXT,  -- JSON for quote reposts: { url, authorSlug, authorName, text }
    top_comments   TEXT,  -- JSON array
    raw            TEXT,
    status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','replied','skipped')),
    handled_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    handled_at     TEXT,
    first_seen_at  TEXT NOT NULL DEFAULT ${NOW},
    updated_at     TEXT NOT NULL DEFAULT ${NOW},
    UNIQUE (contact_id, li_id)
  );
  CREATE INDEX posts_contact_date ON posts(contact_id, posted_at DESC);
  CREATE INDEX posts_date ON posts(posted_at DESC);

  -- One Bright Data snapshot. Covers one or more contacts.
  CREATE TABLE sync_runs (
    id           INTEGER PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('posts','profile')),
    snapshot_id  TEXT UNIQUE,
    status       TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','ready','failed')),
    start_date   TEXT,
    end_date     TEXT,
    requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL DEFAULT ${NOW},
    finished_at  TEXT,
    records      INTEGER NOT NULL DEFAULT 0,
    new_posts    INTEGER NOT NULL DEFAULT 0,
    error        TEXT
  );

  CREATE TABLE sync_run_contacts (
    run_id      INTEGER NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
    contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    records     INTEGER NOT NULL DEFAULT 0,
    new_posts   INTEGER NOT NULL DEFAULT 0,
    note        TEXT,
    PRIMARY KEY (run_id, contact_id)
  );
  CREATE INDEX sync_run_contacts_contact ON sync_run_contacts(contact_id);
  `,
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
  INSERT INTO settings (key, value) VALUES ('auto_pull_hours', '0');
  `,
  `
  -- Companies we target (ABM accounts). Imported from Notion; contacts belong to one.
  CREATE TABLE accounts (
    id          INTEGER PRIMARY KEY,
    notion_id   TEXT UNIQUE,
    name        TEXT NOT NULL,
    website     TEXT,
    tier        TEXT,
    size        TEXT,
    industry    TEXT,
    stage       TEXT,
    why_now     TEXT,
    created_at  TEXT NOT NULL DEFAULT ${NOW},
    updated_at  TEXT NOT NULL DEFAULT ${NOW}
  );

  ALTER TABLE contacts ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;
  ALTER TABLE contacts ADD COLUMN role TEXT;          -- title as our CRM knows it (LinkedIn headline stays in headline)
  ALTER TABLE contacts ADD COLUMN persona TEXT;       -- Champion / Economic Buyer / Influencer
  ALTER TABLE contacts ADD COLUMN region TEXT;
  ALTER TABLE contacts ADD COLUMN campaign TEXT;
  ALTER TABLE contacts ADD COLUMN connection TEXT;    -- our LinkedIn connection status: Connected / Request Sent
  ALTER TABLE contacts ADD COLUMN qualification TEXT; -- Qualified / Disqualified
  ALTER TABLE contacts ADD COLUMN notion_id TEXT;
  CREATE UNIQUE INDEX contacts_notion ON contacts(notion_id);
  CREATE INDEX contacts_account ON contacts(account_id);
  `,
  `
  -- Kept in the CRM but left out of every posts pull (manual, bulk and automatic).
  ALTER TABLE contacts ADD COLUMN skip_pulls INTEGER NOT NULL DEFAULT 0;
  `,
  `
  -- Posts a teammate has set aside to reply to.
  CREATE TABLE reply_list (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id   INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    added_at  TEXT NOT NULL DEFAULT ${NOW},
    PRIMARY KEY (user_id, post_id)
  );

  -- Touches with a person, shaped like the Notion ABM CRM "Activities" database so they map 1:1.
  CREATE TABLE activities (
    id           INTEGER PRIMARY KEY,
    contact_id   INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    post_id      INTEGER REFERENCES posts(id) ON DELETE SET NULL,
    user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    title        TEXT,             -- Notion "Touch"
    channel      TEXT,             -- LinkedIn / Email / Call
    touch_type   TEXT,             -- Comment / Post / DM / Connect Request / Profile View …
    outcome      TEXT,             -- Sent / Replied / Connected …
    notes        TEXT,
    occurred_at  TEXT NOT NULL,
    source       TEXT NOT NULL DEFAULT 'pulse' CHECK (source IN ('pulse','notion')),
    notion_id    TEXT UNIQUE,      -- set when imported from (or pushed to) Notion
    created_at   TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX activities_contact ON activities(contact_id, occurred_at DESC);
  CREATE INDEX activities_post ON activities(post_id);
  `,
  `
  -- Set when Pulse changes something Notion should hear about (owner, connection, last touch).
  ALTER TABLE contacts ADD COLUMN notion_dirty INTEGER NOT NULL DEFAULT 0;

  -- The Brain: what Pulse knows about Mercity (positioning, tone, talking points), kept by admins.
  CREATE TABLE brain_entries (
    id          INTEGER PRIMARY KEY,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    position    INTEGER NOT NULL DEFAULT 0,
    updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT ${NOW},
    updated_at  TEXT NOT NULL DEFAULT ${NOW}
  );

  INSERT INTO settings (key, value) VALUES ('notion_sync_hours', '12') ON CONFLICT (key) DO NOTHING;
  `,
  `
  -- A reply a teammate is writing for a post, kept until it's sent.
  CREATE TABLE reply_drafts (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    body        TEXT NOT NULL,
    touch_type  TEXT NOT NULL DEFAULT 'Comment',
    updated_at  TEXT NOT NULL DEFAULT ${NOW},
    PRIMARY KEY (user_id, post_id)
  );
  `,
  `
  -- Who gets pulled. 'auto' follows the pull rules (Brain); 'always' / 'never' override them.
  ALTER TABLE contacts ADD COLUMN pull_mode TEXT NOT NULL DEFAULT 'auto' CHECK (pull_mode IN ('auto','always','never'));
  UPDATE contacts SET pull_mode = 'never' WHERE skip_pulls = 1;

  -- A company can have an owner (synced with Notion's Account Owner) and its own pull setting.
  ALTER TABLE accounts ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
  ALTER TABLE accounts ADD COLUMN pull_mode TEXT NOT NULL DEFAULT 'auto' CHECK (pull_mode IN ('auto','always','never'));
  ALTER TABLE accounts ADD COLUMN notion_dirty INTEGER NOT NULL DEFAULT 0;

  -- People with their effective owner: their own, or else their company's.
  CREATE VIEW people AS
    SELECT c.*, COALESCE(c.owner_id, a.owner_id) AS eff_owner_id,
           (c.owner_id IS NULL AND a.owner_id IS NOT NULL) AS owner_via_company,
           a.owner_id AS account_owner_id, a.pull_mode AS account_pull_mode, a.tier AS account_tier
    FROM contacts c LEFT JOIN accounts a ON a.id = c.account_id;

  INSERT INTO settings (key, value)
  VALUES ('pull_rules', '{"includeDisqualified":false,"onlyOwned":false,"tiers":["A","B","C","none"]}')
  ON CONFLICT (key) DO NOTHING;
  `,
  `
  -- Pulls are decided per company only; contacts.pull_mode is no longer read.
  UPDATE contacts SET pull_mode = 'auto';
  UPDATE settings SET value = json_remove(json_set(value, '$.onlyOwnedCompanies', json(CASE WHEN json_extract(value, '$.onlyOwned') THEN 'true' ELSE 'false' END)), '$.onlyOwned')
  WHERE key = 'pull_rules';

  DROP VIEW people;
  CREATE VIEW people AS
    SELECT c.*, COALESCE(c.owner_id, a.owner_id) AS eff_owner_id,
           (c.owner_id IS NULL AND a.owner_id IS NOT NULL) AS owner_via_company,
           a.owner_id AS account_owner_id, a.pull_mode AS account_pull_mode, a.tier AS account_tier, a.stage AS account_stage
    FROM contacts c LEFT JOIN accounts a ON a.id = c.account_id;
  `,
  `
  -- New default pull rules: Tier A and B companies that someone on the team is assigned to.
  INSERT INTO settings (key, value) VALUES ('pull_rules', '{"includeDisqualified":false,"onlyOwnedCompanies":true,"tiers":["A","B"]}')
  ON CONFLICT (key) DO UPDATE SET value = excluded.value;
  `,
];

function migrate() {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      db.exec(migrations[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
migrate();

export const nowIso = () => new Date().toISOString();

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string | null) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
