/**
 * Imports a Notion ABM CRM "Activities" snapshot (data/notion-activities.json) as touches on people.
 * The live sync (src/notion.ts) does the same straight from Notion.
 */
import fs from 'node:fs';
import path from 'node:path';
import { applyCrm } from '../src/crm.ts';

type Row = [string, string | null, string | null, string | null, string | null, string | null, string | null, string | null, string | null];

const file = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '../../data/notion-activities.json'));
const { activities } = JSON.parse(fs.readFileSync(file, 'utf8')) as { activities: Row[] };
const owners = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'notion-abm.json'), 'utf8')).owners as Record<string, string>;

const { activities: s } = applyCrm({
  activities: activities.map(([notionId, title, date, contactNotionId, owner, channel, touchType, outcome, notes]) => ({
    notionId,
    title,
    date,
    contactNotionId,
    owner: owner && owners[owner] ? { email: owners[owner]!, name: '' } : null,
    channel,
    touchType,
    outcome,
    notes,
  })),
});

console.log(`Activities from ${path.relative(process.cwd(), file)}
  ${s.added} new, ${s.updated} updated, ${s.skipped} skipped (person not in Pulse)
  ${s.linkedToPost} linked to a pulled post, ${s.postsMarkedReplied} of those posts marked replied`);
