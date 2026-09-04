import type {
  Commit,
  CreditDataPoint,
  Developer,
  DeveloperDetail,
  DeveloperTicket,
  JiraTicket,
  PaginatedResponse,
  PullRequest,
  SonarQubeData,
  TierDistribution,
  TopUser,
} from '@/types';

// =====================================================
// Mock Jira tickets
// =====================================================

const mockTickets: JiraTicket[] = [
  {
    id: '1', key: 'VAN-10452', summary: 'Implement user authentication with SSO',
    assignee: { name: 'Rohit Sharma', email: 'rohit@example.com', avatarUrl: '' },
    reporter: { name: 'Priya Nair', email: 'priya@example.com', avatarUrl: '' },
    status: { name: 'In progress', category: 'in-progress' },
    priority: { name: 'High', level: 'high' },
    issueType: { name: 'Story', iconUrl: '' },
    project: 'Vantage', sprint: 'Sprint 14', labels: ['auth', 'sso', 'security'],
    description: 'Implement Single Sign-On (SSO) authentication using Azure AD. This includes SAML 2.0 integration, user provisioning on first login, user attribute mapping, and securing the login flow.\n\nAcceptance criteria:\n- Users can log in via Azure AD SSO\n- First-time users are auto-provisioned\n- User attributes (name, email, role) are mapped correctly\n- Session management follows security best practices',
    resolution: null, created: '2025-05-01T09:00:00Z', updated: '2025-05-17T14:30:00Z',
  },
  {
    id: '2', key: 'VAN-10451', summary: 'Add data quality checks in ingestion pipeline',
    assignee: { name: 'Priya Nair', email: 'priya@example.com', avatarUrl: '' },
    reporter: { name: 'Arjun Mehta', email: 'arjun@example.com', avatarUrl: '' },
    status: { name: 'To do', category: 'to-do' },
    priority: { name: 'High', level: 'high' },
    issueType: { name: 'Story', iconUrl: '' },
    project: 'Vantage', sprint: 'Sprint 14', labels: ['data-quality'],
    description: 'Add validation checks at each stage of the data ingestion pipeline to catch malformed records early.',
    resolution: null, created: '2025-05-02T10:00:00Z', updated: '2025-05-17T13:45:00Z',
  },
  {
    id: '3', key: 'VAN-10450', summary: 'Refactor feature store service',
    assignee: { name: 'Arjun Mehta', email: 'arjun@example.com', avatarUrl: '' },
    reporter: { name: 'Sneha Iyer', email: 'sneha@example.com', avatarUrl: '' },
    status: { name: 'In progress', category: 'in-progress' },
    priority: { name: 'Medium', level: 'medium' },
    issueType: { name: 'Task', iconUrl: '' },
    project: 'Vantage', sprint: 'Sprint 14', labels: ['refactor'],
    description: 'Refactor the feature store service to improve query performance and reduce memory footprint.',
    resolution: null, created: '2025-05-03T08:30:00Z', updated: '2025-05-17T12:00:00Z',
  },
  {
    id: '4', key: 'VAN-10449', summary: 'Fix model monitoring alert noise',
    assignee: { name: 'Sneha Iyer', email: 'sneha@example.com', avatarUrl: '' },
    reporter: { name: 'Rohit Sharma', email: 'rohit@example.com', avatarUrl: '' },
    status: { name: 'In progress', category: 'in-progress' },
    priority: { name: 'High', level: 'high' },
    issueType: { name: 'Bug', iconUrl: '' },
    project: 'Vantage', sprint: 'Sprint 14', labels: ['monitoring', 'alerts'],
    description: 'Reduce false positive alerts in the model monitoring system. Current thresholds are too sensitive.',
    resolution: null, created: '2025-05-04T11:00:00Z', updated: '2025-05-17T10:00:00Z',
  },
  {
    id: '5', key: 'VAN-10448', summary: 'Update dependencies for python modules',
    assignee: { name: 'Karan Verma', email: 'karan@example.com', avatarUrl: '' },
    reporter: { name: 'Ananya Joshi', email: 'ananya@example.com', avatarUrl: '' },
    status: { name: 'To do', category: 'to-do' },
    priority: { name: 'Low', level: 'low' },
    issueType: { name: 'Task', iconUrl: '' },
    project: 'Vantage', sprint: 'Sprint 14', labels: ['dependencies'],
    description: 'Update all Python module dependencies to their latest stable versions.',
    resolution: null, created: '2025-05-05T09:15:00Z', updated: '2025-05-17T09:00:00Z',
  },
  {
    id: '6', key: 'VAN-10447', summary: 'Improve CI pipeline efficiency',
    assignee: { name: 'Ananya Joshi', email: 'ananya@example.com', avatarUrl: '' },
    reporter: { name: 'Karan Verma', email: 'karan@example.com', avatarUrl: '' },
    status: { name: 'In progress', category: 'in-progress' },
    priority: { name: 'Medium', level: 'medium' },
    issueType: { name: 'Story', iconUrl: '' },
    project: 'Vantage', sprint: 'Sprint 13', labels: ['ci-cd'],
    description: 'Optimize the CI pipeline to reduce build times from 45 minutes to under 20 minutes.',
    resolution: null, created: '2025-05-06T14:00:00Z', updated: '2025-05-17T07:00:00Z',
  },
  {
    id: '7', key: 'VAN-10446', summary: 'Add unit tests for data transform utils',
    assignee: { name: 'Rohit Sharma', email: 'rohit@example.com', avatarUrl: '' },
    reporter: { name: 'Priya Nair', email: 'priya@example.com', avatarUrl: '' },
    status: { name: 'Done', category: 'done' },
    priority: { name: 'Low', level: 'low' },
    issueType: { name: 'Task', iconUrl: '' },
    project: 'Vantage', sprint: 'Sprint 13', labels: ['testing'],
    description: 'Add comprehensive unit tests for all data transformation utility functions.',
    resolution: 'Done', created: '2025-05-07T10:00:00Z', updated: '2025-05-17T06:00:00Z',
  },
  {
    id: '8', key: 'VAN-10445', summary: 'Integrate SonarQube quality gate',
    assignee: { name: 'Arjun Mehta', email: 'arjun@example.com', avatarUrl: '' },
    reporter: { name: 'Sneha Iyer', email: 'sneha@example.com', avatarUrl: '' },
    status: { name: 'Done', category: 'done' },
    priority: { name: 'Medium', level: 'medium' },
    issueType: { name: 'Story', iconUrl: '' },
    project: 'Vantage', sprint: 'Sprint 13', labels: ['quality', 'sonarqube'],
    description: 'Integrate SonarQube quality gate checks into the CI/CD pipeline.',
    resolution: 'Done', created: '2025-05-08T08:00:00Z', updated: '2025-05-17T04:00:00Z',
  },
  {
    id: '9', key: 'VAN-10444', summary: 'Handle missing values in training dataset',
    assignee: { name: 'Priya Nair', email: 'priya@example.com', avatarUrl: '' },
    reporter: { name: 'Arjun Mehta', email: 'arjun@example.com', avatarUrl: '' },
    status: { name: 'To do', category: 'to-do' },
    priority: { name: 'Low', level: 'low' },
    issueType: { name: 'Story', iconUrl: '' },
    project: 'Vantage', sprint: 'Sprint 15', labels: ['ml', 'data'],
    description: 'Implement strategies for handling missing values in training datasets.',
    resolution: null, created: '2025-05-09T09:00:00Z', updated: '2025-05-17T02:00:00Z',
  },
  {
    id: '10', key: 'VAN-10443', summary: 'Create dashboard for model drift metrics',
    assignee: { name: 'Sneha Iyer', email: 'sneha@example.com', avatarUrl: '' },
    reporter: { name: 'Rohit Sharma', email: 'rohit@example.com', avatarUrl: '' },
    status: { name: 'To do', category: 'to-do' },
    priority: { name: 'High', level: 'high' },
    issueType: { name: 'Story', iconUrl: '' },
    project: 'Vantage', sprint: 'Sprint 15', labels: ['dashboard', 'ml'],
    description: 'Build a dashboard to visualize model drift metrics over time.',
    resolution: null, created: '2025-05-10T10:00:00Z', updated: '2025-05-17T00:00:00Z',
  },
];

// =====================================================
// Mock commits for VAN-10452
// =====================================================

const mockCommits: Commit[] = [
  {
    hash: '3c8b1f2e7d4a9c6b8e1f3a7d9b2c0e4f5a6b7c8d', shortHash: '3c8b1f2',
    subject: 'Implement token validation and user provisioning',
    body: 'Implement token validation and user provisioning\n- Add token validation using JWKS\n- Implement user provisioning for first-time login\n- Add error handling for invalid/expired tokens',
    branch: 'feature/auth-sso', author: { name: 'Rohit Sharma', email: 'rohit@example.com', avatarUrl: '' },
    timestamp: '2025-05-17T13:30:00Z', repositoryName: 'vantage/auth-service',
    additions: 120, deletions: 45,
    filesChanged: ['src/auth/token-validator.ts', 'src/auth/user-provisioning.ts', 'src/auth/jwks-client.ts', 'src/routes/auth.ts', 'tests/auth/token-validator.test.ts', 'tests/auth/user-provisioning.test.ts', 'src/config/sso.ts', 'src/middleware/auth.ts', 'src/types/auth.ts', 'package.json'],
    kiroCredits: 1.25, kiroConfidence: 'high', kiroEpisode: 'ep_683a1b2c3d4e',
    secretScanStatus: 'clean',
  },
  {
    hash: 'a9f4d2e8b7c3a1f6d5e9b8c2a4f7d1e3b6c9a2f5', shortHash: 'a9f4d2e',
    subject: 'Add unit tests for SSO service',
    body: 'Add unit tests for SSO service\n- Test SAML assertion parsing\n- Test user attribute mapping\n- Test session creation and validation',
    branch: 'feature/auth-sso', author: { name: 'Reha Sharma', email: 'reha@example.com', avatarUrl: '' },
    timestamp: '2025-05-17T11:00:00Z', repositoryName: 'vantage/auth-service',
    additions: 210, deletions: 16,
    filesChanged: ['tests/sso/saml-parser.test.ts', 'tests/sso/attribute-mapper.test.ts', 'tests/sso/session.test.ts'],
    kiroCredits: 2.10, kiroConfidence: 'high', kiroEpisode: 'ep_683a1b2c3d4e',
    secretScanStatus: 'clean',
  },
  {
    hash: '7b2e9a1f4d8c6b3e5a7f2d9c1b4e8a3f6d7c0b2e', shortHash: '7b2e9a1',
    subject: 'Refactor auth flow and error handling',
    body: 'Refactor auth flow and error handling\n- Centralize error handling middleware\n- Add structured logging for auth events\n- Improve error messages for SSO failures',
    branch: 'feature/auth-sso', author: { name: 'Neha Verma', email: 'neha@example.com', avatarUrl: '' },
    timestamp: '2025-05-17T07:00:00Z', repositoryName: 'vantage/auth-service',
    additions: 75, deletions: 12,
    filesChanged: ['src/middleware/error-handler.ts', 'src/auth/sso-flow.ts', 'src/utils/logger.ts'],
    kiroCredits: 0.85, kiroConfidence: 'high', kiroEpisode: 'ep_683a2c4e5f6a',
    secretScanStatus: 'clean',
  },
  {
    hash: '5d6c7b0a9e8f1d2c3b4a5f6e7d8c9b0a1f2e3d4c', shortHash: '5d6c7b0',
    subject: 'Add SSO configuration and environment variables',
    body: 'Add SSO configuration and environment variables\n- Add Azure AD configuration\n- Set up environment variable handling\n- Add configuration validation on startup',
    branch: 'feature/auth-sso', author: { name: 'Aman Gupta', email: 'aman@example.com', avatarUrl: '' },
    timestamp: '2025-05-16T10:00:00Z', repositoryName: 'vantage/auth-service',
    additions: 34, deletions: 2,
    filesChanged: ['src/config/azure-ad.ts', '.env.example'],
    kiroCredits: 0.40, kiroConfidence: 'low', kiroEpisode: 'ep_683a2c4e5f6a',
    secretScanStatus: 'clean',
  },
  {
    hash: 'c1a2b3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0', shortHash: 'c1a2b3d',
    subject: 'Update login page UI and validation messages',
    body: 'Update login page UI and validation messages\n- Add SSO login button\n- Update validation error messages\n- Add loading states during SSO redirect',
    branch: 'develop', author: { name: 'Neha Verma', email: 'neha@example.com', avatarUrl: '' },
    timestamp: '2025-05-15T14:00:00Z', repositoryName: 'vantage/auth-service',
    additions: 98, deletions: 31,
    filesChanged: ['src/pages/login.tsx', 'src/components/sso-button.tsx', 'src/styles/login.css'],
    kiroCredits: 14.50, kiroConfidence: 'high', kiroEpisode: 'ep_683b3d5e6f7b',
    secretScanStatus: 'clean',
  },
  {
    hash: '9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f', shortHash: '9e8f7a6',
    subject: 'Initial SSO integration with Azure AD',
    body: 'Initial SSO integration with Azure AD\n- Add SAML 2.0 service provider configuration\n- Implement IdP metadata parsing\n- Set up assertion consumer service endpoint',
    branch: 'develop', author: { name: 'Rohit Sharma', email: 'rohit@example.com', avatarUrl: '' },
    timestamp: '2025-05-14T09:00:00Z', repositoryName: 'vantage/auth-service',
    additions: 256, deletions: 62,
    filesChanged: ['src/auth/saml-sp.ts', 'src/auth/idp-metadata.ts', 'src/routes/sso.ts', 'src/types/saml.ts', 'package.json', 'package-lock.json'],
    kiroCredits: 5.30, kiroConfidence: 'high', kiroEpisode: 'ep_683b3d5e6f7b',
    secretScanStatus: 'clean',
  },
  {
    hash: '4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c', shortHash: '4b5c6d7',
    subject: 'Create SSO service and interfaces',
    body: 'Create SSO service and interfaces\n- Define SSO service interface\n- Implement base service class\n- Add Azure AD provider implementation',
    branch: 'develop', author: { name: 'Aman Gupta', email: 'aman@example.com', avatarUrl: '' },
    timestamp: '2025-05-14T08:00:00Z', repositoryName: 'vantage/auth-service',
    additions: 180, deletions: 28,
    filesChanged: ['src/services/sso-service.ts', 'src/services/azure-ad-provider.ts', 'src/interfaces/sso.ts', 'src/types/provider.ts'],
    kiroCredits: 3.40, kiroConfidence: 'high', kiroEpisode: 'ep_683b3d5e6f7b',
    secretScanStatus: 'clean',
  },
];

// =====================================================
// Mock pull requests for VAN-10452
// =====================================================

const mockPullRequests: PullRequest[] = [
  {
    id: '131', title: 'Implement SSO authentication with Azure AD',
    description: 'This PR implements Single Sign-On (SSO) authentication using Azure AD. It integrates SAML 2.0, adds user provisioning on first login, maps user attributes, and secures the login flow.',
    status: 'merged', sourceBranch: 'feature/auth-sso', targetBranch: 'develop',
    author: { name: 'Rohit Sharma', email: 'rohit@example.com', avatarUrl: '' },
    reviewers: [
      { person: { name: 'Neha Verma', email: 'neha@example.com', avatarUrl: '' }, status: 'approved' },
      { person: { name: 'Aman Gupta', email: 'aman@example.com', avatarUrl: '' }, status: 'pending' },
      { person: { name: 'Rekha Nair', email: 'rekha@example.com', avatarUrl: '' }, status: 'changes-requested' },
    ],
    commitCount: 4, filesChanged: 18, additions: 420, deletions: 128,
    checks: [
      { name: 'CI / Build', status: 'passed' },
      { name: 'Unit Tests', status: 'passed' },
      { name: 'SonarQube Quality Gate', status: 'failed' },
    ],
    kiroCredits: 8.45, opened: '2025-05-15T10:00:00Z',
    codeCommitUrl: 'https://us-east-1.console.aws.amazon.com/codesuite/codecommit/repositories/vantage-auth/pull-requests/131',
  },
  {
    id: '128', title: 'Add SSO configuration and environment variables',
    description: 'Configuration setup for Azure AD SSO integration.',
    status: 'merged', sourceBranch: 'feature/auth-sso', targetBranch: 'develop',
    author: { name: 'Aman Gupta', email: 'aman@example.com', avatarUrl: '' },
    reviewers: [
      { person: { name: 'Rohit Sharma', email: 'rohit@example.com', avatarUrl: '' }, status: 'approved' },
      { person: { name: 'Neha Verma', email: 'neha@example.com', avatarUrl: '' }, status: 'approved' },
    ],
    commitCount: 2, filesChanged: 5, additions: 34, deletions: 2,
    checks: [
      { name: 'CI / Build', status: 'passed' },
      { name: 'Unit Tests', status: 'passed' },
    ],
    kiroCredits: 0.40, opened: '2025-05-13T09:00:00Z',
    codeCommitUrl: 'https://us-east-1.console.aws.amazon.com/codesuite/codecommit/repositories/vantage-auth/pull-requests/128',
  },
  {
    id: '122', title: 'Add auth service and JWT validation',
    description: 'Core authentication service with JWT token validation.',
    status: 'merged', sourceBranch: 'feature/auth-sso', targetBranch: 'develop',
    author: { name: 'Rohit Sharma', email: 'rohit@example.com', avatarUrl: '' },
    reviewers: [
      { person: { name: 'Aman Gupta', email: 'aman@example.com', avatarUrl: '' }, status: 'approved' },
      { person: { name: 'Sneha Iyer', email: 'sneha@example.com', avatarUrl: '' }, status: 'approved' },
    ],
    commitCount: 3, filesChanged: 12, additions: 289, deletions: 45,
    checks: [
      { name: 'CI / Build', status: 'passed' },
      { name: 'Unit Tests', status: 'passed' },
      { name: 'SonarQube Quality Gate', status: 'passed' },
    ],
    kiroCredits: 5.30, opened: '2025-05-10T11:00:00Z',
    codeCommitUrl: 'https://us-east-1.console.aws.amazon.com/codesuite/codecommit/repositories/vantage-auth/pull-requests/122',
  },
  {
    id: '118', title: 'Add unit tests for auth service',
    description: 'Comprehensive unit test coverage for authentication service.',
    status: 'closed', sourceBranch: 'feature/auth-sso', targetBranch: 'develop',
    author: { name: 'Neha Verma', email: 'neha@example.com', avatarUrl: '' },
    reviewers: [
      { person: { name: 'Rohit Sharma', email: 'rohit@example.com', avatarUrl: '' }, status: 'approved' },
      { person: { name: 'Aman Gupta', email: 'aman@example.com', avatarUrl: '' }, status: 'approved' },
    ],
    commitCount: 2, filesChanged: 8, additions: 156, deletions: 12,
    checks: [
      { name: 'CI / Build', status: 'passed' },
      { name: 'Unit Tests', status: 'passed' },
    ],
    kiroCredits: 2.10, opened: '2025-05-08T14:00:00Z',
    codeCommitUrl: 'https://us-east-1.console.aws.amazon.com/codesuite/codecommit/repositories/vantage-auth/pull-requests/118',
  },
  {
    id: '111', title: 'Spike: Evaluate Azure AD integration options',
    description: 'Evaluation of different Azure AD integration approaches.',
    status: 'closed', sourceBranch: 'spike/azure-ad-sso', targetBranch: 'develop',
    author: { name: 'Aman Gupta', email: 'aman@example.com', avatarUrl: '' },
    reviewers: [
      { person: { name: 'Rohit Sharma', email: 'rohit@example.com', avatarUrl: '' }, status: 'approved' },
      { person: { name: 'Sneha Iyer', email: 'sneha@example.com', avatarUrl: '' }, status: 'approved' },
    ],
    commitCount: 1, filesChanged: 3, additions: 45, deletions: 0,
    checks: [
      { name: 'CI / Build', status: 'passed' },
    ],
    kiroCredits: 0.65, opened: '2025-05-03T10:00:00Z',
    codeCommitUrl: 'https://us-east-1.console.aws.amazon.com/codesuite/codecommit/repositories/vantage-auth/pull-requests/111',
  },
];

// =====================================================
// Mock SonarQube data for VAN-10452
// =====================================================

const mockSonarQube: SonarQubeData = {
  connected: true,
  qualityGate: 'passed',
  lastScan: '2025-05-17T14:12:00Z',
  metrics: {
    bugs: { value: 3, grade: 'A' },
    vulnerabilities: { value: 0, grade: 'A' },
    codeSmells: { value: 8, grade: 'B' },
    coverage: { value: 84.2, grade: 'A' },
  },
  issues: [
    {
      id: '1', file: 'auth.service.ts', line: 128,
      description: 'Hardcoded string literal "admin" should not be used.',
      severity: 'critical', type: 'bug',
      ruleDescription: 'Hardcoded credentials or string literals such as "admin" introduce a security risk because attackers can easily discover and exploit them.\n\nRule: S6443 — Hardcoded password literals',
      suggestedFix: 'Remove the hardcoded string and retrieve the value from a secure configuration source (e.g., environment variable or secrets manager).',
      sonarQubeUrl: 'https://sonarqube.example.com/issues/1',
    },
    {
      id: '2', file: 'auth.controller.ts', line: 72,
      description: 'Missing rate limiting on login endpoint may allow brute force attacks.',
      severity: 'major', type: 'vulnerability',
      ruleDescription: 'Login endpoints without rate limiting are vulnerable to credential stuffing and brute force attacks.',
      suggestedFix: 'Add rate limiting middleware to the login endpoint with appropriate thresholds.',
      sonarQubeUrl: 'https://sonarqube.example.com/issues/2',
    },
    {
      id: '3', file: 'token.service.ts', line: 45,
      description: 'JWT token is not validated for expiration in some code paths.',
      severity: 'major', type: 'vulnerability',
      ruleDescription: 'All JWT token validation paths must check the expiration claim to prevent use of expired tokens.',
      suggestedFix: 'Ensure all token validation code paths include expiration checking.',
      sonarQubeUrl: 'https://sonarqube.example.com/issues/3',
    },
    {
      id: '4', file: 'user.service.ts', line: 201,
      description: 'Use of console.log() detected.',
      severity: 'minor', type: 'code-smell',
      ruleDescription: 'Production code should use a proper logging framework instead of console.log().',
      suggestedFix: 'Replace console.log() with the project\'s structured logger.',
      sonarQubeUrl: 'https://sonarqube.example.com/issues/4',
    },
    {
      id: '5', file: 'auth.module.ts', line: 18,
      description: "Unused import 'ClientSession'.",
      severity: 'minor', type: 'code-smell',
      ruleDescription: 'Unused imports increase bundle size and reduce code clarity.',
      suggestedFix: 'Remove the unused import.',
      sonarQubeUrl: 'https://sonarqube.example.com/issues/5',
    },
  ],
  trend: 'Coverage +2.4% since last scan',
};

// =====================================================
// Mock developers (S3 usage report data)
// =====================================================

const mockDevelopers: Developer[] = [
  { id: '1', name: 'Rohit Sharma', email: 'rohit@example.com', avatarUrl: '', tier: 'PRO_PLUS', creditsUsed: 247.8, creditsTrend: 8, activeSince: '2024-11-01', lastActive: '2025-05-17', coveragePercent: 94, ticketsWorkedOn: 23 },
  { id: '2', name: 'Priya Nair', email: 'priya@example.com', avatarUrl: '', tier: 'PRO', creditsUsed: 156.3, creditsTrend: -5, activeSince: '2024-12-15', lastActive: '2025-05-17', coveragePercent: 87, ticketsWorkedOn: 18 },
  { id: '3', name: 'Arjun Mehta', email: 'arjun@example.com', avatarUrl: '', tier: 'PRO_PLUS', creditsUsed: 312.5, creditsTrend: 12, activeSince: '2024-10-20', lastActive: '2025-05-17', coveragePercent: 91, ticketsWorkedOn: 28 },
  { id: '4', name: 'Sneha Iyer', email: 'sneha@example.com', avatarUrl: '', tier: 'PRO', creditsUsed: 83.2, creditsTrend: 3, activeSince: '2025-01-10', lastActive: '2025-05-16', coveragePercent: 78, ticketsWorkedOn: 12 },
  { id: '5', name: 'Karan Verma', email: 'karan@example.com', avatarUrl: '', tier: 'PRO', creditsUsed: 27.4, creditsTrend: -2, activeSince: '2025-03-01', lastActive: '2025-05-15', coveragePercent: 65, ticketsWorkedOn: 6 },
  { id: '6', name: 'Ananya Joshi', email: 'ananya@example.com', avatarUrl: '', tier: 'PRO_PLUS', creditsUsed: 198.7, creditsTrend: 6, activeSince: '2024-11-15', lastActive: '2025-05-17', coveragePercent: 89, ticketsWorkedOn: 21 },
  { id: '7', name: 'Neha Verma', email: 'neha@example.com', avatarUrl: '', tier: 'PRO', creditsUsed: 112.9, creditsTrend: 1, activeSince: '2025-01-05', lastActive: '2025-05-17', coveragePercent: 82, ticketsWorkedOn: 15 },
  { id: '8', name: 'Aman Gupta', email: 'aman@example.com', avatarUrl: '', tier: 'PRO', creditsUsed: 64.1, creditsTrend: 4, activeSince: '2025-02-20', lastActive: '2025-05-16', coveragePercent: 71, ticketsWorkedOn: 9 },
  { id: '9', name: 'Rekha Nair', email: 'rekha@example.com', avatarUrl: '', tier: 'PRO', creditsUsed: 15.6, creditsTrend: -10, activeSince: '2025-04-01', lastActive: '2025-05-14', coveragePercent: 55, ticketsWorkedOn: 4 },
  { id: '10', name: 'Reha Sharma', email: 'reha@example.com', avatarUrl: '', tier: 'PRO_PLUS', creditsUsed: 221.3, creditsTrend: 7, activeSince: '2024-10-15', lastActive: '2025-05-17', coveragePercent: 92, ticketsWorkedOn: 25 },
];

// =====================================================
// Mock developer detail
// =====================================================

function makeCreditHistory(): CreditDataPoint[] {
  const points: CreditDataPoint[] = [];
  const start = new Date('2025-05-01');
  for (let i = 0; i < 17; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    points.push({
      date: d.toISOString().slice(0, 10),
      credits: Math.round((5 + Math.random() * 20) * 100) / 100,
    });
  }
  return points;
}

function makeDeveloperTickets(): DeveloperTicket[] {
  return [
    { ticketId: 'VAN-10452', summary: 'Implement user authentication with SSO', status: { name: 'In progress', category: 'in-progress' }, creditsUsed: 24.8, lastCommit: '2025-05-17T13:30:00Z' },
    { ticketId: 'VAN-10446', summary: 'Add unit tests for data transform utils', status: { name: 'Done', category: 'done' }, creditsUsed: 8.2, lastCommit: '2025-05-12T16:00:00Z' },
    { ticketId: 'VAN-10440', summary: 'Set up auth middleware', status: { name: 'Done', category: 'done' }, creditsUsed: 12.5, lastCommit: '2025-05-08T11:00:00Z' },
  ];
}

// =====================================================
// Exposed mock fetchers (match real API signatures)
// =====================================================

export function getMockTickets(params: {
  page?: number; pageSize?: number; search?: string; project?: string; status?: string;
}): PaginatedResponse<JiraTicket> {
  let items = [...mockTickets];
  if (params.search) {
    const s = params.search.toLowerCase();
    items = items.filter(t => t.key.toLowerCase().includes(s) || t.summary.toLowerCase().includes(s) || t.assignee.name.toLowerCase().includes(s));
  }
  if (params.status && params.status !== 'all') {
    items = items.filter(t => t.status.name.toLowerCase().replace(/\s+/g, '-') === params.status!.toLowerCase().replace(/\s+/g, '-'));
  }
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 10;
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total: items.length,
    page,
    pageSize,
    totalPages: Math.ceil(items.length / pageSize),
  };
}

export function getMockTicketDetail(ticketId: string): JiraTicket | undefined {
  return mockTickets.find(t => t.key === ticketId);
}

export function getMockCommits(_ticketId: string): Commit[] {
  return mockCommits;
}

export function getMockPullRequests(_ticketId: string): PullRequest[] {
  return mockPullRequests;
}

export function getMockSonarQube(_ticketId: string): SonarQubeData {
  return mockSonarQube;
}

export function getMockDevelopers(params: {
  page?: number; pageSize?: number; search?: string; tier?: string;
}): PaginatedResponse<Developer> {
  let items = [...mockDevelopers];
  if (params.search) {
    const s = params.search.toLowerCase();
    items = items.filter(d => d.name.toLowerCase().includes(s));
  }
  if (params.tier && params.tier !== 'all') {
    items = items.filter(d => d.tier === params.tier);
  }
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 10;
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total: items.length,
    page,
    pageSize,
    totalPages: Math.ceil(items.length / pageSize),
  };
}

export function getMockDeveloperDetail(developerId: string): DeveloperDetail | undefined {
  const dev = mockDevelopers.find(d => d.id === developerId);
  if (!dev) return undefined;
  return {
    ...dev,
    creditHistory: makeCreditHistory(),
    tickets: makeDeveloperTickets(),
    recentCommits: mockCommits.slice(0, 5),
  };
}

export function getMockTierDistribution(): TierDistribution[] {
  const counts = new Map<string, number>();
  for (const d of mockDevelopers) {
    counts.set(d.tier, (counts.get(d.tier) ?? 0) + 1);
  }
  const total = mockDevelopers.length;
  return Array.from(counts.entries()).map(([tier, count]) => ({
    tier,
    count,
    percentage: Math.round((count / total) * 1000) / 10,
  }));
}

export function getMockTopUsers(limit = 5): TopUser[] {
  return [...mockDevelopers]
    .sort((a, b) => b.creditsUsed - a.creditsUsed)
    .slice(0, limit)
    .map(d => ({ name: d.name, creditsUsed: d.creditsUsed }));
}
