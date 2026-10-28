# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Pulse is Mercity's internal tool for tracking the LinkedIn posts and reposts of people in the Notion ABM CRM, assigning teammates as owners, and logging replies ("touches") back to Notion. See README.md for the user-facing behaviour.

## Commands

npm workspaces: `server/` (Express + better-sqlite3, run directly with tsx, no build step) and `web/` (React 19 + Vite + Tailwind v4).

```bash
npm install
npm run dev                       # web on :5180 (proxies /api) + API on 127.0.0.1:4848, both hot-reload
npm run dev:demo                  # same, against data/demo.db
npm run build                     # web only: tsc -b && vite build → web/dist
npm start                         # production: Express serves web/dist and the API on API_PORT
npm run import:notion -w server   # re-import the offline Notion snapshots in data/*.json
npx tsc --noEmit -p server        # type-check the server
npx tsc --noEmit -p web           # type-check the web app
```

There are no tests or linter; type-checks plus checking in the browser are the verification loop. `.claude/launch.json` has `pulse` and `pulse-demo` preview configs. Use `API_PORT`, not `PORT`, for the API (preview tooling sets `PORT` for the web server). Port 8787 on this machine belongs to another project.

Config lives in `.env` (see `.env.example`): Bright Data key, admin seed credentials (used only on first boot), `NOTION_TOKEN` / `NOTION_ABM_PAGE_ID`, optional `HOST`, `DB_PATH`, `COOKIE_SECURE`.

## Architecture

**Database (`server/src/db.ts`).** Schema is an append-only `migrations` array applied by `PRAGMA user_version`. Never edit an existing migration; append a new one. The `people` view joins contacts to their company and adds `eff_owner_id` (person owner, else the company owner), `owner_via_company`, `account_owner_id`, `account_pull_mode`, `account_tier` and `account_stage`. Query `people` and filter on `eff_owner_id` whenever ownership matters. Settings (schedules, pull rules, Notion sync state) are key/value rows in `settings`.

**Pulling posts (`server/src/sync.ts`, `brightdata.ts`).** `startPostsSync` triggers a Bright Data "discover by profile URL" job (reposts included), recording it in `sync_runs` and `sync_run_contacts`. A poller (`startPoller`, every 8s) checks progress, downloads the snapshot and ingests it. Records map back to contacts via `discovery_input.url` → profile slug. Post kinds are post / quote / repost; article cards and LinkedIn ghost avatars get special handling. Each pull sees only about the 10 newest activity items per profile and is billed per record, so history comes from repeated pulls.

The same poller runs:
- **Automatic pulls:** on a grid lined up with an IST time of day, using the settings `auto_pull_hours`, `auto_pull_at` and `auto_pull_anchor`.
- **The Notion auto-sync.**

Only one server instance should run against a given database; otherwise both pull and both sync.

**Who gets pulled (`server/src/pulls.ts`).** One `eligibility()` decides it for every path: automatic, bulk, and hand-picked (`startPostsSync` filters by it).
- Pull control is per company only. A company's `pull_mode` (always / never) wins; otherwise the global rules apply: include disqualified (company stage or person qualification), only companies with an assigned teammate, and tiers.
- `contacts.pull_mode` and `contacts.skip_pulls` are legacy columns and are not read. Don't reintroduce per-person pull overrides.
- The web label maps in `web/src/components/crm.tsx` (`PULL_REASON`) mirror the reason enum.

**Notion sync (`server/src/notion.ts`, `crm.ts`).**
- `notion.ts` talks to the Notion API (version `2026-03-11`: databases expose `data_sources`). It's throttled to about 3 requests/s with retries, and finds the Accounts, Contacts and Activities databases under the ABM page.
- A sync pushes first, then pulls.
- `applyCrm()` in `crm.ts` is shared by the live sync and the snapshot import scripts. Notion wins for CRM fields; Pulse wins for owners (never overwritten by a pull, written back to Notion).
- Local changes set `notion_dirty` and call `requestNotionSync()`, which debounces a sync about 20s later.
- Touches live in `activities` with `source` = pulse or notion and a `notion_id`. Editing or deleting a touch in Pulse updates or trashes the Notion page. Deleting a post's last touch reopens the post. A Notion activity whose notes link to a pulled post attaches to it and marks it replied.

**API (`server/src/api/*`).** One Express router per resource, mounted in `index.ts`. Validation uses zod. Auth is a cookie session (hashed tokens in `sessions`), and `requireAdmin` guards admin routes (team, Brain, pull rules, schedules). Serializers such as `serializeContact` and `serializePost` define the JSON shapes.

**Web (`web/src`).**
- Pages live in `pages/`. All server data goes through react-query hooks in `lib/queries.ts`. `lib/api.ts` holds the TypeScript types, which must be kept in sync with the server serializers by hand.
- The `@` alias points at `src/`. Radix-based primitives live in `components/ui/`. Shared pieces: `PostCard`, `touches.tsx` (reply composer and timeline), `dialogs.tsx` (pull dialogs, `PullButton`, owner select), `schedule.tsx` (IST schedule controls) and `CommandMenu` (⌘K, filtered client-side to avoid DB queries).
- Styling uses Tailwind v4 tokens defined with `@theme inline` in `index.css`, a root font size of 14px, light and dark themes, sonner toasts and motion transitions.
- Tailwind v4 `translate-*` utilities set the CSS `translate` property, so keyframes should animate `transform` only and never re-apply a translate.

## Data and deploy notes

- `data/pulse.db` is the live database. The other files in `data/` are import snapshots and `pulse.before-*.db` backups; don't deploy them.
- Back up the database (`sqlite3 data/pulse.db ".backup …"`) before bulk data changes.
- Pulls and Notion syncs cost money or write to the real Notion CRM. Test against `data/demo.db` or a database copy (`DB_PATH`) when possible, and undo any test changes made to live data.
