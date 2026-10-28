export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export const qs = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
};

// ---------------------------------------------------------------------------
// Types mirrored from the server

export type Role = 'admin' | 'member';

export interface User {
  id: number;
  email: string;
  name: string;
  title: string | null;
  role: Role;
  active: boolean;
  createdAt: string;
  passwordSetAt: string;
  lastLoginAt: string | null;
}

export interface TeamMember extends User {
  contacts: number;
  openPosts: number;
}

export interface OwnerRef {
  id: number;
  name: string;
  /** Inherited from the person's company. */
  viaCompany?: boolean;
}

export type PullMode = 'auto' | 'always' | 'never';
export type PullReason = 'company-always' | 'company-never' | 'company-disqualified' | 'disqualified' | 'no-owner' | 'tier' | 'rules';

export interface PullRules {
  includeDisqualified: boolean;
  /** Only people at a company someone on the team is assigned to. */
  onlyOwnedCompanies: boolean;
  tiers: string[];
}

export interface PullSummary {
  total: number;
  eligible: number;
  new: number;
  excluded: Partial<Record<PullReason, number>>;
  rules: PullRules;
}

export interface Company {
  id: number;
  name: string;
  tier: string | null;
  website: string | null;
  size: string | null;
  industry: string | null;
  stage: string | null;
  pullMode: PullMode;
  owner: OwnerRef | null;
  notionUrl: string | null;
  people: number;
  pulled: number;
}

export interface Account {
  id: number;
  name: string;
  owner: OwnerRef | null;
  pullMode: PullMode;
  website: string | null;
  tier: string | null;
  size: string | null;
  industry: string | null;
  stage: string | null;
  whyNow: string | null;
  notionUrl: string | null;
}

export interface Contact {
  id: number;
  slug: string;
  url: string;
  name: string | null;
  headline: string | null;
  company: string | null;
  location: string | null;
  avatarUrl: string | null;
  followers: number | null;
  notes: string | null;
  owner: OwnerRef | null;
  role: string | null;
  persona: string | null;
  region: string | null;
  campaign: string | null;
  connection: string | null;
  qualification: string | null;
  notionUrl: string | null;
  /** Whether pulls include this person, and why (decided by their company; see server/src/pulls.ts). */
  pull: { eligible: boolean; reason: PullReason };
  account: Account | null;
  createdAt: string;
  profileSyncedAt: string | null;
  postsSyncedAt: string | null;
  stats: { total: number; recent: number; reposts: number; open: number; lastPostAt: string | null };
  syncing: { posts: boolean; profile: boolean };
}

export type PostKind = 'post' | 'quote' | 'repost';
export type PostStatus = 'open' | 'replied' | 'skipped';

export interface PostMedia {
  images: string[];
  videos: string[];
  videoThumb: string | null;
  videoDuration: number | null;
  document: { cover: string; pages: number | null } | null;
  link: { url: string | null; title: string | null; description: string | null; image: string | null } | null;
}

export interface Post {
  id: number;
  liId: string;
  url: string;
  kind: PostKind;
  author: { slug: string | null; name: string | null; title: string | null; avatarUrl: string | null; url: string | null };
  title: string | null;
  text: string | null;
  postedAt: string | null;
  likes: number | null;
  comments: number | null;
  media: PostMedia;
  /** A shared LinkedIn article (Bright Data reports these as plain posts). */
  article: { title: string | null; cover: string } | null;
  original: { url: string | null; authorSlug: string | null; authorName: string | null; text: string | null; date: string | null } | null;
  topComments: { name: string | null; slug: string | null; url: string | null; text: string; date: string | null; likes: number | null }[];
  status: PostStatus;
  handledBy: string | null;
  handledAt: string | null;
  firstSeenAt: string;
  /** On the signed-in teammate's reply list. */
  inList: boolean;
  /** The signed-in teammate's unsent reply to this post. */
  draft: { body: string; touchType: string } | null;
  /** The most recent touch logged against this post (what we replied). */
  lastTouch: { type: string | null; notes: string | null; by: string | null; at: string } | null;
  contact: {
    id: number;
    slug: string;
    name: string | null;
    headline: string | null;
    role: string | null;
    company: string | null;
    avatarUrl: string | null;
    owner: OwnerRef | null;
  };
}

export interface SyncHistoryItem {
  id: number;
  kind: 'posts' | 'profile';
  status: 'running' | 'ready' | 'failed';
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
  records: number;
  newPosts: number;
  note: string | null;
  requestedBy: string | null;
}

export interface SyncRun {
  id: number;
  kind: 'posts' | 'profile';
  status: 'running' | 'ready' | 'failed';
  snapshotId: string;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  finishedAt: string | null;
  records: number;
  newPosts: number;
  error: string | null;
  requestedBy: string | null;
  contactCount: number;
  contacts: { id: number; name: string | null; slug: string; avatarUrl: string | null; records: number; newPosts: number; note: string | null }[];
}

export interface Overview {
  kpis: {
    people: number;
    unassigned: number;
    mine: number;
    week: number;
    prevWeek: number;
    openMine: number;
    openAll: number;
    handledWeek: number;
    listTodo: number;
  };
  activity: { date: string; posts: number; reposts: number }[];
  active: {
    id: number;
    name: string | null;
    slug: string;
    avatarUrl: string | null;
    headline: string | null;
    owner: OwnerRef | null;
    posts: number;
    lastPostAt: string | null;
  }[];
  queue: Post[];
  lastSyncAt: string | null;
  trackingSince: string | null;
}

export interface Colleague {
  id: number;
  name: string | null;
  slug: string;
  avatarUrl: string | null;
  role: string | null;
  owner: string | null;
}

export type TouchType = 'Comment' | 'Post' | 'DM' | 'Connect Request' | 'Profile View';

export interface Activity {
  id: number;
  title: string | null;
  channel: string | null;
  touchType: string | null;
  outcome: string | null;
  notes: string | null;
  occurredAt: string;
  by: string | null;
  postId: number | null;
  postUrl: string | null;
  source: 'pulse' | 'notion';
  notionUrl: string | null;
}

export interface BrainEntry {
  id: number;
  title: string;
  body: string;
  position: number;
  updatedAt: string;
  updatedBy: string | null;
}

export interface CrmStats {
  accounts: { added: number; updated: number };
  people: { added: number; updated: number; ownersSet: number; skipped: string[] };
  activities: { added: number; updated: number; removed: number; skipped: number; linkedToPost: number; postsMarkedReplied: number };
  teammatesCreated: string[];
}

export interface NotionSyncResult {
  startedAt: string;
  finishedAt: string;
  trigger: 'auto' | 'manual';
  by: string | null;
  ok: boolean;
  error?: string;
  pushed?: { activitiesCreated: number; activitiesWaiting: number; contactsUpdated: number };
  pulled?: CrmStats;
}

export interface NotionStatus {
  configured: boolean;
  hours: number;
  running: boolean;
  last: NotionSyncResult | null;
  nextAt: string | null;
  pendingActivities: number;
}

export type NotionConnection =
  | { configured: false }
  | { configured: true; ok: true; name: string; workspace: string | null }
  | { configured: true; ok: false; error: string };
