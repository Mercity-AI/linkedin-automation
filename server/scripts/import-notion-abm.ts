/**
 * Imports a Notion "ABM CRM" snapshot (Accounts + Contacts) into Pulse. The live sync (src/notion.ts)
 * does the same thing straight from Notion; this is for offline snapshots.
 *
 *   npm run import:notion -w server              # uses data/notion-abm.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { applyCrm, type ContactIn } from '../src/crm.ts';

type AccountRow = [string, string, string | null, string | null, string | null, string | null, string | null, string | null];
type ContactRow = [string, string, string | null, string | null, string | null, string | null, string | null, string | null, 'S' | 'G' | null, string | null, 'Q' | 'D' | null, string | null];

const file = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '../../data/notion-abm.json'));
const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { owners: Record<string, string>; accounts: AccountRow[]; contacts: ContactRow[] };
const CAMPAIGNS = { S: 'Security & Guardrails', G: 'General ICP' } as const;
const QUALIFICATION = { Q: 'Qualified', D: 'Disqualified' } as const;

const stats = applyCrm({
  accounts: data.accounts.map(([notionId, name, website, tier, size, industry, stage, whyNow]) => ({ notionId, name, website, tier, size, industry, stage, whyNow })),
  contacts: data.contacts.map(
    ([notionId, name, role, linkedin, accountNotionId, persona, region, location, campaign, connection, qual, owner]): ContactIn => ({
      notionId,
      name,
      role,
      linkedin,
      accountNotionId,
      persona,
      region,
      location,
      campaign: campaign ? CAMPAIGNS[campaign] : null,
      connection,
      qualification: qual ? QUALIFICATION[qual] : null,
      owner: owner && data.owners[owner] ? { email: data.owners[owner]!, name: '' } : null,
    }),
  ),
});

console.log(`Imported from ${path.relative(process.cwd(), file)}
  accounts: ${stats.accounts.added} new, ${stats.accounts.updated} updated
  people:   ${stats.people.added} new, ${stats.people.updated} updated, ${stats.people.ownersSet} given an owner
  skipped (no LinkedIn URL): ${stats.people.skipped.join(', ') || 'none'}
  teammates created: ${stats.teammatesCreated.join(', ') || 'none'}`);
