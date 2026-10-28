import { cn } from '@/lib/utils';
import type { PullMode, PullReason } from '@/lib/api';
import { Tooltip, type SelectOption } from './ui/menu';
import { Pill } from './ui/misc';

/** ABM tier A/B/C. Only A gets the accent — it's the one that changes priority. */
export function TierBadge({ tier, className }: { tier: string | null | undefined; className?: string }) {
  if (!tier) return null;
  return (
    <span
      title={`Tier ${tier}`}
      className={cn(
        'inline-grid size-[18px] shrink-0 place-items-center rounded-[5px] text-[10.5px] font-semibold leading-none',
        tier === 'A' ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-ink-2',
        className,
      )}
    >
      {tier}
    </span>
  );
}

const connectionTone: Record<string, string> = {
  Connected: 'bg-positive',
  'Request Sent': 'bg-warning',
};

/** Our LinkedIn connection with this person, as tracked in the CRM. */
export function ConnectionLabel({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) return <span className={cn('text-ink-4', className)}>Not connected</span>;
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-ink-2', className)}>
      <span className={cn('size-1.5 rounded-full', connectionTone[value] ?? 'bg-ink-4')} />
      {value === 'Request Sent' ? 'Request sent' : value}
    </span>
  );
}

export function DisqualifiedPill({ value }: { value: string | null | undefined }) {
  if (value !== 'Disqualified') return null;
  return (
    <Pill tone="negative" className="h-[18px] px-1.5 text-[11px]">
      Disqualified
    </Pill>
  );
}

export const TIER_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All tiers' },
  { value: 'A', label: 'Tier A' },
  { value: 'B', label: 'Tier B' },
  { value: 'C', label: 'Tier C' },
];

export const PERSONA_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'Any persona' },
  { value: 'Economic Buyer', label: 'Economic Buyer' },
  { value: 'Champion', label: 'Champion' },
  { value: 'Influencer', label: 'Influencer' },
];

export const CONNECTION_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'Any connection' },
  { value: 'Connected', label: 'Connected' },
  { value: 'Request Sent', label: 'Request sent' },
  { value: 'none', label: 'Not connected' },
];

// --- Pull rules -------------------------------------------------------------------

/** Why someone is (or isn't) in pulls, in words. Mirrors server/src/pulls.ts. */
export const PULL_REASON: Record<PullReason, string> = {
  'company-always': 'Pulled: their company is set to Always',
  'company-never': 'Not pulled: their company is set to Never',
  'company-disqualified': 'Not pulled: their company is disqualified',
  disqualified: 'Not pulled: disqualified',
  'no-owner': 'Not pulled: nobody is assigned to their company',
  tier: 'Not pulled: their company’s tier isn’t included',
  rules: 'Pulled: matches the pull rules',
};

export const PULL_MODE_LABEL: Record<PullMode, string> = { auto: 'Follow pull rules', always: 'Always pull', never: 'Never pull' };

export const PULL_MODE_OPTIONS: { value: PullMode; label: string }[] = [
  { value: 'auto', label: 'Follow rules' },
  { value: 'always', label: 'Always pull' },
  { value: 'never', label: 'Never pull' },
];

export function PullPill({ pull }: { pull: { eligible: boolean; reason: PullReason } }) {
  if (pull.eligible) return null;
  return (
    <Tooltip content={PULL_REASON[pull.reason]}>
      <span>
        <Pill tone="neutral" className="h-[18px] px-1.5 text-[11px]">
          Not pulled
        </Pill>
      </span>
    </Tooltip>
  );
}
