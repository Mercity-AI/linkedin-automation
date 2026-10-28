/**
 * Who gets their posts pulled. One place decides it, for manual, bulk and automatic pulls alike.
 *
 * Pulls are decided per company, never per person: a company set to Always/Never wins; otherwise the pull rules
 * apply (disqualified companies and people, companies nobody on the team is assigned to, tiers). The rules live in
 * settings and are edited in the Brain. People without a company only go through the rules.
 */
import { db, getSetting, setSetting } from './db.ts';

export type PullMode = 'auto' | 'always' | 'never';

export interface PullRules {
  includeDisqualified: boolean;
  /** Only people at a company someone on our team is assigned to. */
  onlyOwnedCompanies: boolean;
  /** Tiers to include; 'none' means people whose company has no tier. */
  tiers: string[];
}

const DEFAULT_RULES: PullRules = { includeDisqualified: false, onlyOwnedCompanies: true, tiers: ['A', 'B'] };

export function getPullRules(): PullRules {
  try {
    const { onlyOwned: _old, ...saved } = JSON.parse(getSetting('pull_rules') ?? '{}');
    return { ...DEFAULT_RULES, ...saved };
  } catch {
    return DEFAULT_RULES;
  }
}

export const setPullRules = (rules: PullRules) => setSetting('pull_rules', JSON.stringify(rules));

export interface EligibilityInput {
  account_pull_mode: PullMode | null;
  account_owner_id: number | null;
  account_stage: string | null;
  account_tier: string | null;
  qualification: string | null;
}

export type PullReason =
  | 'company-always'
  | 'company-never'
  | 'company-disqualified'
  | 'disqualified'
  | 'no-owner'
  | 'tier'
  | 'rules';

export function eligibility(c: EligibilityInput, rules = getPullRules()): { eligible: boolean; reason: PullReason } {
  if (c.account_pull_mode === 'always') return { eligible: true, reason: 'company-always' };
  if (c.account_pull_mode === 'never') return { eligible: false, reason: 'company-never' };
  if (!rules.includeDisqualified && c.account_stage === 'Disqualified') return { eligible: false, reason: 'company-disqualified' };
  if (!rules.includeDisqualified && c.qualification === 'Disqualified') return { eligible: false, reason: 'disqualified' };
  if (rules.onlyOwnedCompanies && !c.account_owner_id) return { eligible: false, reason: 'no-owner' };
  if (!rules.tiers.includes(c.account_tier ?? 'none')) return { eligible: false, reason: 'tier' };
  return { eligible: true, reason: 'rules' };
}

export const ELIGIBILITY_COLUMNS = 'account_pull_mode, account_owner_id, account_stage, account_tier, qualification';

const allPeople = () =>
  db.prepare(`SELECT id, posts_synced_at, ${ELIGIBILITY_COLUMNS} FROM people`).all() as (EligibilityInput & {
    id: number;
    posts_synced_at: string | null;
  })[];

/** 'eligible' = everyone the rules say to pull; 'new' = those of them who have never been pulled. */
export function idsForScope(scope: 'eligible' | 'new'): number[] {
  const rules = getPullRules();
  return allPeople()
    .filter((c) => eligibility(c, rules).eligible && (scope === 'eligible' || !c.posts_synced_at))
    .map((c) => c.id);
}

export function pullSummary() {
  const rules = getPullRules();
  const excluded: Record<string, number> = {};
  let eligible = 0;
  let fresh = 0;
  const people = allPeople();
  for (const c of people) {
    const e = eligibility(c, rules);
    if (e.eligible) {
      eligible++;
      if (!c.posts_synced_at) fresh++;
    } else excluded[e.reason] = (excluded[e.reason] ?? 0) + 1;
  }
  return { total: people.length, eligible, new: fresh, excluded, rules };
}
