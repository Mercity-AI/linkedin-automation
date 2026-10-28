import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, qs, type Activity, type BrainEntry, type Company, type PullMode, type PullRules, type PullSummary, type NotionConnection, type NotionStatus, type NotionSyncResult, type Colleague, type Contact, type Overview, type Post, type PostStatus, type SyncHistoryItem, type SyncRun, type TeamMember, type User } from './api';

export const keys = {
  me: ['me'] as const,
  team: ['team'] as const,
  contacts: (f?: object) => (f ? (['contacts', f] as const) : (['contacts'] as const)),
  contact: (id: number) => ['contact', id] as const,
  posts: (f?: object) => (f ? (['posts', f] as const) : (['posts'] as const)),
  overview: ['overview'] as const,
  syncs: ['syncs'] as const,
  active: ['syncs-active'] as const,
};

/** Everything derived from posts/contacts — refreshed after a sync lands or an assignment changes. */
export function invalidateData(qc: QueryClient) {
  for (const k of [['contacts'], ['contact'], ['posts'], ['overview'], ['syncs'], ['team']]) qc.invalidateQueries({ queryKey: k });
}

const showError = (e: Error) => toast.error(e.message);

// --- Session ----------------------------------------------------------------

export const useMe = () =>
  useQuery({
    queryKey: keys.me,
    queryFn: () => api.get<{ user: User | null }>('/auth/me').then((r) => r.user),
    staleTime: 5 * 60_000,
  });

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(keys.me, null);
    },
  });
}

// --- Team -------------------------------------------------------------------

export const useTeam = () =>
  useQuery({ queryKey: keys.team, queryFn: () => api.get<{ users: TeamMember[] }>('/users').then((r) => r.users) });

// --- Contacts ---------------------------------------------------------------

export interface ContactFilters {
  owner?: string;
  q?: string;
  tier?: string;
  persona?: string;
  connection?: string;
  qualification?: string;
  pulled?: string;
}

export const useContacts = (f: ContactFilters) =>
  useQuery({
    queryKey: keys.contacts(f),
    queryFn: () => api.get<{ contacts: Contact[] }>(`/contacts${qs({ ...f })}`).then((r) => r.contacts),
    placeholderData: keepPreviousData,
  });

export const useContact = (id: number) =>
  useQuery({
    queryKey: keys.contact(id),
    queryFn: () =>
      api.get<{ contact: Contact; history: SyncHistoryItem[]; colleagues: Colleague[]; activities: Activity[] }>(`/contacts/${id}`),
  });

export function useAssign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, ownerId }: { ids: number[]; ownerId: number | null }) =>
      ids.length === 1 ? api.patch(`/contacts/${ids[0]}`, { ownerId }) : api.patch('/contacts', { ids, ownerId }),
    onSuccess: () => invalidateData(qc),
    onError: showError,
  });
}

export const usePullSummary = () =>
  useQuery({ queryKey: ['pull-summary'], queryFn: () => api.get<PullSummary>('/settings/pull-rules') });

export function useSetPullRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rules: PullRules) => api.put<PullSummary>('/settings/pull-rules', rules),
    onSuccess: (data) => {
      qc.setQueryData(['pull-summary'], data);
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['contact'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: showError,
  });
}

export const useCompanies = () =>
  useQuery({ queryKey: ['accounts'], queryFn: () => api.get<{ accounts: Company[] }>('/accounts').then((r) => r.accounts) });

export function useUpdateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; ownerId?: number | null; pullMode?: PullMode }) => api.patch(`/accounts/${id}`, body),
    onSuccess: () => {
      invalidateData(qc);
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['pull-summary'] });
    },
    onError: showError,
  });
}

/** Pull everyone the rules cover, or only those never pulled before. */
export function usePullScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { scope: 'eligible' | 'new'; start?: string; end?: string }) =>
      api.post<{ runId: number | null; skipped: number; excluded: number; people: number }>('/contacts/pull', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.active });
      invalidateData(qc);
      qc.invalidateQueries({ queryKey: ['pull-summary'] });
    },
    onError: showError,
  });
}

export function useStartSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { ids: number[]; start?: string; end?: string }) =>
      api.post<{ runId: number | null; skipped: number; excluded: number }>('/contacts/sync', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.active });
      invalidateData(qc);
    },
    onError: showError,
  });
}

// --- Posts ------------------------------------------------------------------

export interface PostFilters {
  contact?: number;
  owner?: string;
  kind?: string;
  status?: string;
  q?: string;
}

const PAGE = 20;

export const usePosts = (f: PostFilters) =>
  useInfiniteQuery({
    queryKey: keys.posts(f),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.get<{ posts: Post[]; total: number; offset: number }>(`/posts${qs({ ...f, limit: PAGE, offset: pageParam })}`),
    getNextPageParam: (last) => (last.offset + last.posts.length < last.total ? last.offset + last.posts.length : undefined),
    placeholderData: keepPreviousData,
  });

/** Swap an updated post into every cached feed page so cards change in place, then refresh the counts around it. */
function applyPost(qc: QueryClient, post: Post) {
  qc.setQueriesData<{ pages: { posts: Post[] }[] }>({ queryKey: ['posts'] }, (data) =>
    data ? { ...data, pages: data.pages.map((p) => ({ ...p, posts: p.posts.map((x) => (x.id === post.id ? post : x)) })) } : data,
  );
  for (const k of [['overview'], ['contacts'], ['contact'], ['team'], ['list']]) qc.invalidateQueries({ queryKey: k });
}

export function useSetPostStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: PostStatus }) => api.patch<{ post: Post }>(`/posts/${id}`, { status }),
    onSuccess: ({ post }) => applyPost(qc, post),
    onError: showError,
  });
}

export function useLogReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, touchType, notes }: { id: number; touchType: string; notes?: string }) =>
      api.post<{ post: Post; activityId: number; contactId: number }>(`/posts/${id}/log`, { touchType, notes }),
    onSuccess: ({ post }) => applyPost(qc, post),
    onError: showError,
  });
}

export function useSaveDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body, touchType }: { id: number; body: string; touchType: string }) =>
      api.put<{ post: Post }>(`/posts/${id}/draft`, { body, touchType }),
    onSuccess: ({ post }) => {
      qc.setQueriesData<{ pages: { posts: Post[] }[] }>({ queryKey: ['posts'] }, (data) =>
        data ? { ...data, pages: data.pages.map((p) => ({ ...p, posts: p.posts.map((x) => (x.id === post.id ? post : x)) })) } : data,
      );
      qc.invalidateQueries({ queryKey: ['list'] });
    },
    onError: showError,
  });
}

/** Activities touch posts, people, the overview and the reply list; refresh all of them. */
function afterActivityChange(qc: QueryClient) {
  for (const k of [['contact'], ['contacts'], ['posts'], ['overview'], ['list'], ['team']]) qc.invalidateQueries({ queryKey: k });
}

export function useDeleteActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<{ ok: true; postId: number | null; contactId: number }>(`/activities/${id}`),
    onSuccess: () => afterActivityChange(qc),
    onError: showError,
  });
}

export function useUpdateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; notes?: string | null; touchType?: string; outcome?: string }) =>
      api.patch<{ activity: Activity }>(`/activities/${id}`, body),
    onSuccess: () => afterActivityChange(qc),
    onError: showError,
  });
}

export function useToggleList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, add }: { id: number; add: boolean }) =>
      add ? api.post<{ post: Post }>(`/list/${id}`) : api.del<{ post: Post }>(`/list/${id}`),
    onSuccess: ({ post }) => applyPost(qc, post),
    onError: showError,
  });
}

export const useReplyList = (view: 'todo' | 'done') =>
  useQuery({
    queryKey: ['list', view],
    queryFn: () => api.get<{ posts: Post[]; counts: { todo: number; done: number } }>(`/list${qs({ view })}`),
    placeholderData: keepPreviousData,
  });

export function useLogTouch(contactId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { touchType: string; outcome: string; notes?: string; occurredAt?: string }) =>
      api.post<{ activity: Activity }>(`/contacts/${contactId}/activities`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contact', contactId] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: showError,
  });
}

// --- Overview & syncs -------------------------------------------------------

export const useOverview = () => useQuery({ queryKey: keys.overview, queryFn: () => api.get<Overview>('/overview') });

export const useSyncs = () =>
  useQuery({ queryKey: keys.syncs, queryFn: () => api.get<{ runs: SyncRun[] }>('/syncs?limit=100').then((r) => r.runs) });

export interface ActiveSync {
  id: number;
  kind: 'posts' | 'profile';
  createdAt: string;
  contactIds: number[];
}

export const useActiveSyncs = () =>
  useQuery({
    queryKey: keys.active,
    queryFn: () => api.get<{ active: ActiveSync[] }>('/syncs/active').then((r) => r.active),
    refetchInterval: (q) => (q.state.data?.length ? 4000 : 30_000),
  });

// --- Settings ---------------------------------------------------------------

export interface AutoPull {
  hours: number;
  /** Time of day in India (IST), "HH:MM"; runs line up with it. */
  at: string;
  lastAt: string | null;
  nextAt: string | null;
}

export const useSettings = () =>
  useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ autoPull: AutoPull }>('/settings') });

export function useSetAutoPull() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hours, at }: { hours?: number; at?: string }) =>
      api.patch<{ autoPull: AutoPull }>('/settings', { autoPullHours: hours, autoPullAt: at }),
    onSuccess: (data) => qc.setQueryData(['settings'], data),
    onError: showError,
  });
}

// --- Brain (admins) -----------------------------------------------------------

export interface BrightDataAccount {
  ok: boolean;
  /** Why the balance couldn't be read: the key lacks billing access, or something else went wrong. */
  reason?: 'permission' | 'error';
  error?: string;
  balance?: number;
  credit?: number;
  prepayment?: number;
  pendingCosts?: number;
  usage: { recordsThisMonth: number };
  checkedAt: string;
}

export function useBrightData() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['brightdata'],
    queryFn: () => api.get<BrightDataAccount>('/settings/brightdata'),
    staleTime: 5 * 60_000,
  });
  const refresh = useMutation({
    mutationFn: () => api.get<BrightDataAccount>('/settings/brightdata?refresh=1'),
    onSuccess: (data) => qc.setQueryData(['brightdata'], data),
    onError: showError,
  });
  return { ...query, refresh };
}

export const useBrain = () =>
  useQuery({ queryKey: ['brain'], queryFn: () => api.get<{ entries: BrainEntry[] }>('/brain').then((r) => r.entries) });

export function useBrainMutation() {
  const qc = useQueryClient();
  const done = (r: { entries: BrainEntry[] }) => qc.setQueryData(['brain'], r.entries);
  return {
    create: useMutation({ mutationFn: (b: { title: string; body?: string }) => api.post<{ entries: BrainEntry[] }>('/brain', b), onSuccess: done, onError: showError }),
    update: useMutation({
      mutationFn: ({ id, ...b }: { id: number; title?: string; body?: string }) => api.patch<{ entries: BrainEntry[] }>(`/brain/${id}`, b),
      onSuccess: done,
      onError: showError,
    }),
    remove: useMutation({ mutationFn: (id: number) => api.del<{ entries: BrainEntry[] }>(`/brain/${id}`), onSuccess: done, onError: showError }),
  };
}

// --- Notion sync (admins) -----------------------------------------------------

export const useNotion = () =>
  useQuery({
    queryKey: ['notion'],
    queryFn: () => api.get<{ status: NotionStatus; connection: NotionConnection }>('/notion'),
    refetchInterval: (q) => (q.state.data?.status.running ? 2000 : 60_000),
  });

export function useNotionSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ result: NotionSyncResult; status: NotionStatus }>('/notion/sync'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notion'] });
      invalidateData(qc);
    },
    onError: (e: Error) => {
      qc.invalidateQueries({ queryKey: ['notion'] });
      showError(e);
    },
  });
}

export function useSetNotionHours() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (hours: number) => api.patch<{ status: NotionStatus }>('/notion', { hours }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notion'] }),
    onError: showError,
  });
}
