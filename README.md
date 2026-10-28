# Pulse

LinkedIn posts and reposts from the people Mercity tracks, in one place. Each person has an owner on the team, so it's clear who replies to whom.

Built with React + Vite + Tailwind + Radix on the front, Express + SQLite on the back. Data comes from the [Bright Data LinkedIn scrapers](https://docs.brightdata.com/products/scrapers/linkedin/introduction).

## Run it

```bash
npm install
npm run dev          # web on http://localhost:5180, API on 127.0.0.1:4848
```

Sign in as `pranav@mercity.io`. The first password is `ADMIN_PASSWORD` in `.env`. It's only used to create the owner account on first boot, so change it afterwards from the menu under your name.

`npm run dev:demo` runs the same app against `data/demo.db`, which holds the data from testing (5 public profiles, a "Demo Rep" teammate).

## What's where

| Page | What it's for |
| --- | --- |
| Overview | Your reply queue (original posts from your people that need a reply), posts this week, 30-day activity, most active people |
| Feed | Posts from people assigned to you by default; switch to reposts, everyone, a reply status or one person. "Add to list" saves a post for later; "Write reply" drafts your reply |
| Reply list | Your own list of posts to reply to. Done also holds every post you've logged a reply on, so you can edit or delete it |
| People | The CRM: filter by owner, tier, persona, LinkedIn connection and status (including Pulled / Not pulled), assign owners (one at a time or in bulk), pull posts |
| Pulls | Every Bright Data request with per-person results, plus the automatic pull schedule |
| Brain | Admins only. **Knowledge**: positioning, tone and talking points for reply drafting. **Pull rules**: who gets pulled, plus who is assigned to each company. **Sync & schedule**: Notion sync, automatic pulls, the last pull, and Bright Data credits remaining |
| Team | Admins only: add teammates, generate and reset passwords, deactivate |

Team and Brain sit below a divider in the sidebar. Members can do everything except manage the team, the pull rules and the schedules.

**⌘K / Ctrl+K** opens the command bar from anywhere: jump to a person or company, open a page or quick view (posts that need your reply, your people, Tier A), or run an action (add people, sync with Notion, switch theme, sign out). People and companies are matched in the browser from the list the app already loads, so typing costs no database queries. Post text is searched on the server only when you pick "Search posts for …".

**Replying.** Use "Write reply" on a post. Your draft saves as you type and shows on the card. "Copy & reply on LinkedIn" copies it to your clipboard, opens the post on LinkedIn ready to paste, and logs the reply on the person's timeline (and in Notion). The toast that follows has **View timeline** and **Undo**. "Log only" records a reply you already posted. Every touch can be edited or deleted, from the person's timeline or the ⋯ on the reply shown under a post; deleting also moves the Notion Activity to Notion's trash, and if it was the only reply on a post, the post needs a reply again.

**Who gets pulled.** Pulls are decided per company, never per person: everyone at a company is pulled, or nobody is. Brain → Pull rules holds the global rules:

- **Include disqualified**: off by default, so companies (Stage) and people (Qualification) that Notion marks Disqualified are skipped.
- **Only companies with someone assigned**: on by default, so only companies a teammate is assigned to get pulled.
- **Company tiers**: A and B by default; C and No tier can be switched on.

Below the rules, each company has an **Assigned to** teammate (synced with Notion's Account Owner), who replies to everyone at that company unless a person has an owner of their own. Each company can also be set to **Always pull** or **Never pull**, which overrides the rules for everyone there. Admins can set this from a person's page too.

Every pull follows these rules: automatic, "Pull posts", and people picked by hand. Nobody is ever pulled just because they're in the CRM. The **Pull posts** button pulls everyone the rules cover. Its menu also offers **Only new people**: those the rules cover who have never been pulled. Both sync with Notion first, so people just added to the ABM CRM are included (automatic pulls do the same). A person's page and the People list say why someone isn't pulled. Saved posts stay either way.

## The Notion ABM CRM

People and companies come from Notion's **Marketing / ABM CRM** (the Accounts and Contacts databases). Pulse keeps what helps someone engaging on LinkedIn:

- **Person:** name, role, LinkedIn URL, persona (Champion / Economic Buyer / Influencer), region, location, campaign, our LinkedIn connection status (Connected / Request Sent), qualification and owner.
- **Company:** name, website, tier (A/B/C), size, industry, pipeline stage and the "Trigger Event / Why Now" note.

**Activities** (the third Notion database) come in as each person's **Touches** timeline: connection requests, comments, DMs, who did them and what was said. Replies logged in Pulse use the same shape (channel, touch type, outcome, notes), so they can go back to Notion one-to-one. `npm run import:notion` imports `data/notion-activities.json` too. When a Notion note links to a post Pulse has pulled, the touch attaches to that post, and a comment marks the post replied.

The email-sequence fields (Sequence Step, Next Action, Reply Status) stay in Notion, which remains the source of truth for outreach. Every person and company links back to its Notion page.

### Live two-way sync

Pulse syncs with Notion through an internal connection (`NOTION_TOKEN`) that's been shared with the ABM CRM page (`NOTION_ABM_PAGE_ID`). It finds the Accounts, Contacts and Activities databases under that page on its own.

- **Pulse → Notion.** Touches logged in Pulse (Log reply, Log a touch) become Notion Activities linked to the person's Contact, with owner, outcome, notes and the post link. Changing someone's owner, or logging a connection request, updates their Contact's Owner, LinkedIn Status and Last Touch Date. These go out about 20 seconds after the change.
- **Notion → Pulse.** New and edited accounts, people and activities come in on every sync. An activity deleted in Notion disappears from Pulse. People removed from Notion stay in Pulse with their posts.
- **Who wins.** Notion is the source for CRM fields (role, persona, company, tier…). Pulse is the source for owners: an owner set in Pulse is never overwritten, and it's written back to Notion.
- **When.** Every 12 hours by default, plus **Sync now**, both on the Brain page.

People without a LinkedIn URL are skipped. Notion owners map to Pulse users by email, and a missing teammate gets an account with no usable password; give them one with "Reset password" on the Team page. The connection needs Read content, Insert content, Update content and Read user information (with emails).

`npm run import:notion -w server` still imports the offline snapshots in `data/` using the same rules.

## How pulling works (and its limits)

Pulse calls Bright Data's posts dataset (`gd_lyy3tktm25m4avu764`) with `discover_by=profile_url` and `only_authored_posts=false`, so reposts come back too. New people also get a profile lookup (`gd_l1viktl72bvl7bjuj0`) for name, photo, headline and company.

What testing showed (October 2026):

- **Each pull sees about the 10 newest items on a profile's public activity feed.** `limit_per_input` doesn't raise it. For active posters that's the last week; for quieter people it can reach back months.
- **Dates only filter that window.** Asking Satya Nadella's profile for Sept 1 – Oct 15 or Bill Gates's for April – June returned nothing, because those posts are no longer in the visible feed. It isn't a fixed "last 30 days" window, it's "the last ~10 things".
- So history comes from **pulling regularly**. Pulse keeps every post it has seen and dedupes across pulls. Turn on automatic pulls on the Pulls page or in Brain → Sync & schedule (off by default, since Bright Data bills per record). Pick how often (every 6 or 12 hours, daily, every 2 days) and a time of day in IST. Runs line up with that time: every 12 hours at 9:00 AM means 9:00 AM and 9:00 PM IST. A run missed while the server was off happens when it's back, unless the next one is closer.
- A pull takes 1–3 minutes. Several people go into one Bright Data job.
- Reposts come in two shapes, and Pulse labels both:
  - **Repost**: a plain reshare. It shows the original author's post under "X reposted this".
  - **Repost with commentary**: Bright Data's `post_type=repost`. It shows their comment above the quoted original.
- Occasionally a single post is behind LinkedIn's sign-in wall. The pull notes say so.
- Shared LinkedIn articles come back as plain posts. Pulse spots them by their `article-cover_image` cover and shows an article card with the article's title.

## Config (`.env`)

| Key | |
| --- | --- |
| `BRIGHTDATA_API_KEY` | Bright Data API token |
| `BRIGHTDATA_BILLING_KEY` | Optional key with billing access, used only to show the remaining balance in the Brain (falls back to `BRIGHTDATA_API_KEY`) |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` | Owner account, created on first boot only |
| `API_PORT` | API port (default 4848) |
| `HOST` | Bind address (default `127.0.0.1`; use `0.0.0.0` behind a proxy) |
| `DB_PATH` | SQLite file (default `data/pulse.db`) |
| `NOTION_TOKEN` | Notion internal connection secret (`ntn_…`) |
| `NOTION_ABM_PAGE_ID` | The ABM CRM page the connection is shared with |
| `COOKIE_SECURE` | Set `false` if serving production over plain HTTP |

## Production

```bash
npm run build && npm start   # serves the built app and the API from API_PORT
```

## Code map

- `server/src/db.ts`: schema and migrations (users, sessions, contacts, posts, sync_runs, settings)
- `server/src/sync.ts`: Bright Data jobs, the poller (resumes after restarts), ingest, and automatic pulls
- `server/src/pulls.ts`: who gets pulled (company settings and the pull rules), used by every pull
- `server/src/api/*`: REST routes
- `web/src/pages/*`: one file per screen; `web/src/components/PostCard.tsx` renders posts, reposts and media
