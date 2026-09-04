import type {
  Commit,
  DeveloperDetail,
  Developer,
  JiraTicket,
  PaginatedResponse,
  PullRequest,
  SonarQubeData,
  TierDistribution,
  TopUser,
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
// Commits (via backend → CodeCommit, reads real trailers)
// =====================================================

export async function fetchCommits(ticketId: string): Promise<Commit[]> {
  return fetchJson(`${API_BASE}/commits/${ticketId}`);
}

// =====================================================
// Pull Requests (via backend → CodeCommit)
// =====================================================

export async function fetchPullRequests(ticketId: string): Promise<PullRequest[]> {
  return fetchJson(`${API_BASE}/pullrequests/${ticketId}`);
}

// =====================================================
// SonarQube (via backend proxy — token never sent to frontend)
// =====================================================

export async function fetchSonarQube(ticketId: string): Promise<SonarQubeData> {
  return fetchJson(`${API_BASE}/sonarqube/${ticketId}`);
}

// =====================================================
// Users / Developers (via backend → S3 usage reports)
// =====================================================

export async function fetchDevelopers(params: {
  page?: number;
  pageSize?: number;
  search?: string;
  tier?: string;
  activity?: string;
  coverage?: string;
}): Promise<PaginatedResponse<Developer>> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.search) query.set('search', params.search);
  if (params.tier) query.set('tier', params.tier);
  if (params.activity) query.set('activity', params.activity);
  if (params.coverage) query.set('coverage', params.coverage);
  return fetchJson(`${API_BASE}/kiro-usage/developers?${query.toString()}`);
}

export async function fetchDeveloperDetail(developerId: string): Promise<DeveloperDetail> {
  return fetchJson(`${API_BASE}/kiro-usage/developers/${developerId}`);
}

export async function fetchTierDistribution(): Promise<TierDistribution[]> {
  return fetchJson(`${API_BASE}/kiro-usage/tier-distribution`);
}

export async function fetchTopUsers(limit = 5): Promise<TopUser[]> {
  return fetchJson(`${API_BASE}/kiro-usage/top-users?limit=${limit}`);
}

// =====================================================
// Credit computation utility
// MAX-PER-EPISODE-THEN-SUM: group by Kiro-Episode,
// take max Kiro-Credits per episode, sum across episodes
// =====================================================

export function computeCreditsUsed(commits: Commit[]): number {
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
