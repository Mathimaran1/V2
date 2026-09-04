// =====================================================
// Jira types
// =====================================================

export interface JiraTicket {
  id: string;
  key: string;
  summary: string;
  assignee: Person;
  reporter: Person;
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
// Commit types (from real git trailers via CodeCommit)
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
  creditsUsed: number;
  creditsTrend: number; // percentage vs previous period, positive = up
  activeSince: string;
  lastActive: string;
  coveragePercent: number;
  ticketsWorkedOn: number;
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
