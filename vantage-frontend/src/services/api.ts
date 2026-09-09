import type {
  CommitRecord,
  Developer,
  JiraTicket,
  PaginatedResponse,
  PullRequest,
  SonarQubeData,
  TicketSummary,
} from '@/types';

const API_BASE = '/api';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// =====================================================
// Jira (via Atlassian OAuth 2.0 PKCE from frontend)
// =====================================================

export async function fetchTickets(params: {
  page?: number;
  pageSize?: number;
  search?: string;
  project?: string;
  status?: string;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
}): Promise<PaginatedResponse<JiraTicket>> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.search) query.set('search', params.search);
  if (params.project) query.set('project', params.project);
  if (params.status) query.set('status', params.status);
  if (params.sortField) query.set('sortField', params.sortField);
  if (params.sortDirection) query.set('sortDirection', params.sortDirection);
  return fetchJson(`${API_BASE}/tickets?${query.toString()}`);
}

export async function fetchTicketDetail(ticketId: string): Promise<JiraTicket> {
  return fetchJson(`${API_BASE}/tickets/${ticketId}`);
}

// =====================================================
// Real ticket summaries (via backend → DuckDB/Parquet over CodeCommit —
// NOT Jira; see TicketSummary's own doc comment). Separate from
// fetchTickets/fetchTicketDetail above, which are for the eventual
// Jira-backed /api/tickets endpoint once Step 2 lands — this hits the
// same URL shape but a genuinely different, already-real endpoint.
// =====================================================

export async function fetchTicketsSummary(): Promise<TicketSummary[]> {
  const res = await fetchJson<{ tickets: TicketSummary[] }>(`${API_BASE}/tickets`);
  return res.tickets;
}

export async function fetchTicketSummary(ticketId: string): Promise<TicketSummary> {
  return fetchJson(`${API_BASE}/tickets/${ticketId}`);
}

// =====================================================
// Commits (via backend → DuckDB/Parquet over CodeCommit, real trailers)
// =====================================================

export async function fetchCommits(ticketId: string): Promise<CommitRecord[]> {
  const res = await fetchJson<{ commits: CommitRecord[] }>(`${API_BASE}/commits/${ticketId}`);
  return res.commits;
}

// =====================================================
// Pull Requests (via backend → DuckDB/Parquet over CodeCommit)
// =====================================================

export async function fetchPullRequests(ticketId: string): Promise<PullRequest[]> {
  const res = await fetchJson<{ pullRequests: PullRequest[] }>(`${API_BASE}/pullrequests/${ticketId}`);
  return res.pullRequests;
}

// =====================================================
// SonarQube (via backend proxy — token never sent to frontend)
// =====================================================

export async function fetchSonarQube(ticketId: string): Promise<SonarQubeData> {
  return fetchJson(`${API_BASE}/sonarqube/${ticketId}`);
}

// =====================================================
// Users / Developers (via backend → real S3 usage reports, joined
// against real locally-cached CodeCommit author emails for
// coveragePercent — see backend/routes/developers.py's own docstring
// for the full, verified investigation behind why coveragePercent
// currently comes back null for every real developer, and
// s3_usage_service.py for the real schema/aggregation rules).
//
// No pagination/search/filter params here — the backend returns every
// real developer in one call (145 of them, ~7s including 323 real S3
// file downloads, cached server-side for 5 min) and the page filters/
// paginates client-side, same as the mock data did before it.
//
// fetchDeveloperDetail/fetchTierDistribution/fetchTopUsers used to be
// declared here pointing at /api/kiro-usage/... endpoints that were
// never built and nothing called — removed rather than left as
// dead code implying a backend that doesn't exist. Tier distribution
// and top users are now derived client-side from this same real
// developer list (see UsersPage.tsx) instead of separate endpoints.
// =====================================================

export interface DevelopersResponse {
  developers: Developer[];
  totalCount: number;
}

// days must be one of 1, 30, 90 — matches backend/routes/developers.py's
// _ALLOWED_DAYS exactly (a value outside that set gets a real 400, not
// silently clamped).
export async function fetchDevelopers(days: 1 | 30 | 90 = 30): Promise<DevelopersResponse> {
  return fetchJson(`${API_BASE}/developers?days=${days}`);
}

// =====================================================
// Credit computation utility
// MAX-PER-EPISODE-THEN-SUM: group by Kiro-Episode,
// take max Kiro-Credits per episode, sum across episodes
// =====================================================

export function computeCreditsUsed(commits: { kiroEpisode: string | null; kiroCredits: number | null }[]): number {
  const episodeMaxMap = new Map<string, number>();

  for (const c of commits) {
    if (c.kiroEpisode && c.kiroCredits != null) {
      const current = episodeMaxMap.get(c.kiroEpisode) ?? 0;
      if (c.kiroCredits > current) {
        episodeMaxMap.set(c.kiroEpisode, c.kiroCredits);
      }
    }
  }

  let total = 0;
  for (const max of episodeMaxMap.values()) {
    total += max;
  }
  return Math.round(total * 100) / 100;
}
