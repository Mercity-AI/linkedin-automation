// Thin client over Bright Data's Web Scraper API (datasets v3).
// Docs: https://docs.brightdata.com/products/scrapers/linkedin/introduction

const BASE = 'https://api.brightdata.com/datasets/v3';

export const DATASETS = {
  posts: 'gd_lyy3tktm25m4avu764',
  profiles: 'gd_l1viktl72bvl7bjuj0',
} as const;

export class BrightDataError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

function key() {
  const k = process.env.BRIGHTDATA_API_KEY;
  if (!k) throw new BrightDataError('BRIGHTDATA_API_KEY is not set');
  return k;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json', ...init.headers },
  });
  const body = await res.text();
  if (!res.ok) {
    let msg = body;
    try {
      msg = JSON.parse(body).error ?? body;
    } catch {}
    throw new BrightDataError(`Bright Data ${res.status}: ${msg}`.slice(0, 500), res.status);
  }
  return (body ? JSON.parse(body) : null) as T;
}

export interface PostsDiscoveryInput {
  url: string;
  start_date?: string;
  end_date?: string;
  only_authored_posts?: boolean;
}

/** Discover the posts and reposts on each profile's public activity feed. */
export function triggerPostsDiscovery(inputs: PostsDiscoveryInput[]) {
  const qs = new URLSearchParams({
    dataset_id: DATASETS.posts,
    include_errors: 'true',
    type: 'discover_new',
    discover_by: 'profile_url',
  });
  return call<{ snapshot_id: string }>(`/trigger?${qs}`, {
    method: 'POST',
    body: JSON.stringify({ input: inputs }),
  });
}

export function triggerProfiles(urls: string[]) {
  const qs = new URLSearchParams({ dataset_id: DATASETS.profiles, include_errors: 'true' });
  return call<{ snapshot_id: string }>(`/trigger?${qs}`, {
    method: 'POST',
    body: JSON.stringify({ input: urls.map((url) => ({ url })) }),
  });
}

export interface Progress {
  status: 'starting' | 'running' | 'ready' | 'failed' | string;
  records?: number;
  errors?: number;
  error_codes?: Record<string, number>;
}

export const getProgress = (snapshotId: string) => call<Progress>(`/progress/${snapshotId}`);

export const getSnapshot = <T = Record<string, unknown>>(snapshotId: string) =>
  call<T[]>(`/snapshot/${snapshotId}?format=json`);

export interface Balance {
  /** Available funds, USD. */
  balance: number;
  credit: number;
  prepayment: number;
  /** Usage that goes on the next invoice, USD. */
  pendingCosts: number;
}

/** Account balance. Needs a key with billing access; BRIGHTDATA_BILLING_KEY can be a separate, billing-only key. */
export async function getBalance(): Promise<Balance> {
  const res = await fetch('https://api.brightdata.com/customer/balance', {
    headers: { Authorization: `Bearer ${process.env.BRIGHTDATA_BILLING_KEY || key()}` },
  });
  const body = await res.text();
  if (!res.ok) throw new BrightDataError(`Bright Data ${res.status}: ${body}`.slice(0, 300), res.status);
  const b = JSON.parse(body);
  return {
    balance: Number(b.balance ?? 0),
    credit: Number(b.credit ?? 0),
    prepayment: Number(b.prepayment ?? 0),
    pendingCosts: Number(b.pending_costs ?? b.pending_balance ?? 0),
  };
}
