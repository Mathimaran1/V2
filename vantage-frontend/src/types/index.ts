// =====================================================
// Jira types
// =====================================================

export interface JiraTicket {
  id: string;
  key: string;
  summary: string;
  // Real Jira issues can genuinely have no assignee, and no visible
  // reporter (permission-dependent) — null here is a real state, not a
  // loading placeholder.
  assignee: Person | null;
  reporter: Person | null;
  status: TicketStatus;
  priority: TicketPriority;
  issueType: IssueType;
  project: string;
  sprint: string | null;
  labels: string[];
  description: string;
  resolution: string | null;
  created: string;
  updated: string;
}

export interface Person {
  name: string;
  email: string;
  avatarUrl: string;
}

export interface TicketStatus {
  name: string;
  category: 'to-do' | 'in-progress' | 'done';
}

export interface TicketPriority {
  name: string;
  level: 'highest' | 'high' | 'medium' | 'low' | 'lowest';
}

export interface IssueType {
  name: string;
  iconUrl: string;
}

// =====================================================
// Real ticket summary (from backend GET /api/tickets[/:id] — DuckDB
// over local CodeCommit-derived Parquet cache, NO Jira fields at all;
// Jira isn't wired yet, see Step 2 of the integration plan)
// =====================================================

export interface TicketSummary {
  ticketId: string;
  commitCount: number;
  prCount: number;
  creditsUsed: number;
  jiraValidated: 'true' | 'false' | 'n/a';
  // Raw AWS CodeCommit author-date format ("<epoch> <+HHMM>"), not ISO
  // 8601 — parse with services/utils.ts's parseTimestamp, not `new Date()`
  // directly. Null when the ticket has zero real commits.
  lastCommitAt: string | null;
}

// =====================================================
// Real commit shape (from backend GET /api/commits/:id — exactly
// services/codecommit_service.py's _normalize_commit() keys, confirmed
// against real API output; NOT the same shape as the `Commit` type
// below, which is a richer GitHub-style shape used only by still-mock
// pages). `timestamp` is CodeCommit's raw author-date format, same
// caveat as TicketSummary.lastCommitAt above.
// =====================================================

export interface CommitRecord {
  hash: string;
  fullHash: string;
  message: string;
  subject: string;
  author: string;
  authorEmail: string;
  timestamp: string;
  kiroTicket: string;
  kiroEpisode: string | null;
  kiroCredits: number | null;
  kiroConfidence: 'high' | 'low' | null;
  kiroSession: string | null;
  kiroSource: string | null;
  kiroJiraValidated: boolean | null;
}

// =====================================================
// Commit types (from real git trailers via CodeCommit)
// NOTE: this richer GitHub-style shape (branch, additions/deletions,
// filesChanged, secretScanStatus, structured Person author) is NOT what
// the real backend returns — see CommitRecord above for that. Still
// used by mockData.ts's still-mock pages (DeveloperDetail).
// =====================================================

export interface Commit {
  hash: string;
  shortHash: string;
  subject: string;
  body: string;
  branch: string;
  author: Person;
  timestamp: string;
  repositoryName: string;
  additions: number;
  deletions: number;
  filesChanged: string[];
  // Trailer fields exposed to UI
  kiroCredits: number | null;
  kiroConfidence: 'high' | 'low' | null;
  // Internal trailer fields (not displayed, but used for computation)
  kiroEpisode: string | null;
  secretScanStatus: 'clean' | 'found' | 'not-scanned';
}

// =====================================================
// Pull Request types
// =====================================================

export interface PullRequest {
  id: string;
  title: string;
  description: string;
  status: 'open' | 'merged' | 'closed';
  sourceBranch: string;
  targetBranch: string;
  author: Person;
  reviewers: Reviewer[];
  commitCount: number;
  filesChanged: number;
  additions: number;
  deletions: number;
  checks: Check[];
  kiroCredits: number | null;
  opened: string;
  codeCommitUrl: string;
}

export interface Reviewer {
  person: Person;
  status: 'approved' | 'pending' | 'changes-requested';
}

export interface Check {
  name: string;
  status: 'passed' | 'failed' | 'pending';
}

// =====================================================
// SonarQube types
// =====================================================

export interface SonarQubeData {
  connected: boolean;
  qualityGate: 'passed' | 'failed' | null;
  lastScan: string | null;
  metrics: SonarMetrics | null;
  issues: SonarIssue[];
  trend: string | null;
}

export interface SonarMetrics {
  bugs: MetricValue;
  vulnerabilities: MetricValue;
  codeSmells: MetricValue;
  coverage: MetricValue;
}

export interface MetricValue {
  value: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'E';
}

export interface SonarIssue {
  id: string;
  file: string;
  line: number;
  description: string;
  severity: 'blocker' | 'critical' | 'major' | 'minor' | 'info';
  type: 'bug' | 'vulnerability' | 'code-smell';
  ruleDescription: string;
  suggestedFix: string;
  sonarQubeUrl: string;
}

// =====================================================
// User / Developer types (from S3 usage reports)
// =====================================================

export interface Developer {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  tier: string; // DATA-DRIVEN — not hardcoded
  creditsUsed: number; // real, date-filtered by whichever period is currently selected — see fetchDevelopers(days)
  lifetimeCreditsUsed: number; // real, all-time total — never affected by the selected period
  // Period-over-period trend needs a real "current vs previous period"
  // comparison, which needs working date-range filtering — not wired
  // up yet (see the Overview/Users date picker). Genuinely not
  // computable right now, so this is undefined rather than a fake 0 —
  // check for undefined before rendering a trend arrow, don't assume
  // it's always present the way the old mock data did.
  creditsTrend?: number;
  activeSince: string; // earliest date this email appears in the real S3 usage reports fetched — not an account-creation date
  lastActive: string;
  // null when no real match exists between this email and any known
  // CodeCommit commit author email — see coverageNote for the real
  // reason, and backend/routes/developers.py's docstring for the full
  // investigation. Never render a fabricated percentage when this is
  // null; show the honest "not available" state instead.
  coveragePercent: number | null;
  coverageNote?: string;
  ticketsWorkedOn?: number;
}

export interface DeveloperDetail extends Developer {
  creditHistory: CreditDataPoint[];
  tickets: DeveloperTicket[];
  recentCommits: Commit[];
}

export interface CreditDataPoint {
  date: string;
  credits: number;
}

export interface DeveloperTicket {
  ticketId: string;
  summary: string;
  status: TicketStatus;
  creditsUsed: number;
  lastCommit: string;
}

// =====================================================
// Shared / UI types
// =====================================================

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface TierDistribution {
  tier: string;
  count: number;
  percentage: number;
}

export interface TopUser {
  name: string;
  creditsUsed: number;
}

export interface DateRange {
  start: string;
  end: string;
}
