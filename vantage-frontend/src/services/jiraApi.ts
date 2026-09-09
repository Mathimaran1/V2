/**
 * Real Jira Cloud REST API v3 calls, made directly from the browser
 * with the OAuth access token from jiraAuth.ts — no backend proxy
 * (see the integration plan: Jira stays frontend-only, unlike
 * CodeCommit/S3 which need a backend since those need AWS credentials
 * that can't live in the browser).
 */

import { getAccessToken, getCloudId } from '@/services/jiraAuth';
import type { JiraTicket, Person, TicketPriority, TicketStatus } from '@/types';

const FIELDS = 'summary,assignee,reporter,status,priority,issuetype,project,labels,description,created,updated,resolution';

// Real Jira issues only ever carry one of these five out of the box —
// a site can rename/add custom priorities, in which case this falls
// back to 'medium' rather than guessing a level for an unrecognized name.
const KNOWN_PRIORITY_LEVELS: Record<string, TicketPriority['level']> = {
  highest: 'highest', high: 'high', medium: 'medium', low: 'low', lowest: 'lowest',
};

function mapPriority(name: string | undefined): TicketPriority {
  if (!name) return { name: 'None', level: 'medium' };
  const level = KNOWN_PRIORITY_LEVELS[name.toLowerCase()] ?? 'medium';
  return { name, level };
}

function mapStatus(status: { name: string; statusCategory?: { key: string } }): TicketStatus {
  const key = status.statusCategory?.key;
  const category: TicketStatus['category'] = key === 'done' ? 'done' : key === 'indeterminate' ? 'in-progress' : 'to-do';
  return { name: status.name, category };
}

interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  avatarUrls?: Record<string, string>;
}

function mapPerson(user: JiraUser | null | undefined): Person | null {
  if (!user) return null;
  return {
    name: user.displayName,
    // Jira Cloud often withholds emailAddress for privacy (GDPR) even
    // when the user object itself is visible — real absence, not a bug.
    email: user.emailAddress ?? '',
    avatarUrl: user.avatarUrls?.['24x24'] ?? '',
  };
}

// Jira Cloud's REST API v3 returns `description` as Atlassian Document
// Format (a structured JSON doc), not plain text. This walks it and
// extracts text nodes, joining block-level nodes (paragraphs, headings,
// list items) with newlines — a plain-text approximation good enough
// for this panel's rendering, not a full ADF renderer.
interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
}

// Only types that directly hold inline/text content trigger a line
// break. 'listItem' and 'blockquote' are pure structural containers —
// ADF never puts text directly under them, only nested blocks like
// 'paragraph' — so including them here double-counted: the inner
// paragraph would flush the line, then the wrapping listItem/blockquote
// would flush again with nothing left, inserting a spurious blank line.
const BLOCK_TYPES = new Set(['paragraph', 'heading', 'codeBlock']);

function adfToPlainText(node: AdfNode | null | undefined): string {
  if (!node) return '';
  const lines: string[] = [];
  let current = '';

  function walk(n: AdfNode) {
    if (n.type === 'text' && n.text) {
      current += n.text;
    }
    if (n.content) {
      for (const child of n.content) walk(child);
    }
    if (BLOCK_TYPES.has(n.type)) {
      lines.push(current);
      current = '';
    }
  }
  walk(node);
  if (current) lines.push(current);
  return lines.join('\n').trim();
}

/**
 * Fetch one real ticket's Jira details. Throws on any non-2xx response
 * (404 unknown issue, 403 no permission, 401 expired token, etc.) —
 * the caller is responsible for surfacing that honestly, not swallowing
 * it into a fabricated ticket.
 */
export async function fetchJiraIssue(ticketId: string): Promise<JiraTicket> {
  const token = getAccessToken();
  const cloudId = getCloudId();
  if (!token || !cloudId) {
    throw new Error('Not authenticated with Jira');
  }

  const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${encodeURIComponent(ticketId)}?fields=${FIELDS}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jira API error ${res.status}: ${body}`);
  }
  const issue = await res.json();
  const f = issue.fields;

  return {
    id: issue.id,
    key: issue.key,
    summary: f.summary,
    assignee: mapPerson(f.assignee),
    reporter: mapPerson(f.reporter),
    status: mapStatus(f.status),
    priority: mapPriority(f.priority?.name),
    issueType: { name: f.issuetype?.name ?? 'Unknown', iconUrl: f.issuetype?.iconUrl ?? '' },
    project: f.project?.name ?? '',
    // Sprint isn't in FIELDS above — it lives behind a site-specific
    // custom field ID (e.g. customfield_10020) discoverable only via a
    // real GET /rest/api/3/field call, not a fixed field name. Left
    // honestly null rather than guessed; can be added as a follow-up.
    sprint: null,
    labels: f.labels ?? [],
    description: adfToPlainText(f.description),
    resolution: f.resolution?.name ?? null,
    created: f.created,
    updated: f.updated,
  };
}
