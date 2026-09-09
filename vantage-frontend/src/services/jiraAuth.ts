/**
 * Atlassian OAuth 2.0 (3LO) Authorization Code + PKCE flow, entirely
 * frontend-side — no backend involvement, no client secret (PKCE is a
 * public-client flow; the client ID itself is meant to be public).
 *
 * Scopes requested below must exactly match what's actually configured
 * on the "Vantage-Frontend" Atlassian app (Permissions tab → Jira API →
 * Configure) — read:jira-work, read:project:jira, read:user:jira.
 * "Vantage-Frontend" is that Atlassian app's real, currently-registered
 * name in Atlassian's own console — this product was renamed to
 * AI-Dev-Observability 2026-09-09, but the OAuth app itself wasn't
 * (renaming it there is a separate, external action, not a frontend
 * code change); this comment names the real app on purpose, not a
 * missed rename.
 * read:jira-work (classic scope) is required specifically because
 * GET /rest/api/3/issue/{issueIdOrKey} (see jiraApi.ts) is documented
 * in Atlassian's own OpenAPI spec as requiring that classic scope —
 * the granular read:issue-details:jira scope does NOT govern this
 * endpoint (confirmed against the spec after a 401 "scope does not
 * match" error) and read:issue:jira (its Beta granular equivalent)
 * wasn't used here since Atlassian marks it Beta, not Current.
 * No offline_access was requested, so there's no
 * refresh token: the access token expires (Atlassian's default is 1
 * hour) and the user re-authenticates via login() again — a deliberate
 * simplicity trade-off for this phase, not an oversight.
 *
 * Token + resolved Jira cloudId are stored in sessionStorage (per the
 * integration plan's own instruction), not localStorage — cleared when
 * the tab closes.
 */

const CLIENT_ID = import.meta.env.VITE_JIRA_CLIENT_ID as string | undefined;
const REDIRECT_URI = import.meta.env.VITE_JIRA_REDIRECT_URI as string | undefined;
const SCOPES = 'read:jira-work read:project:jira read:user:jira';

const AUTHORIZE_URL = 'https://auth.atlassian.com/authorize';
// Token exchange itself goes through our own backend now (POST
// /api/jira/token) — see handleCallback() below and routes/jira.py.
const ACCESSIBLE_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';

const SS_ACCESS_TOKEN = 'jira_access_token';
const SS_EXPIRES_AT = 'jira_token_expires_at';
const SS_CLOUD_ID = 'jira_cloud_id';
const SS_SITE_NAME = 'jira_site_name';
// Transient, cleared once the callback consumes them:
const SS_PKCE_VERIFIER = 'jira_pkce_verifier';
const SS_OAUTH_STATE = 'jira_oauth_state';
const SS_RETURN_PATH = 'jira_return_path';

function base64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

async function codeChallengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(digest);
}

export function isJiraConfigured(): boolean {
  return Boolean(CLIENT_ID && REDIRECT_URI);
}

/**
 * Kick off login: generate a PKCE verifier/challenge and CSRF state,
 * stash them (and the current path, to return to after auth) in
 * sessionStorage, then redirect the whole page to Atlassian.
 */
export async function login(returnPath: string): Promise<void> {
  if (!CLIENT_ID || !REDIRECT_URI) {
    throw new Error('Jira OAuth is not configured — VITE_JIRA_CLIENT_ID / VITE_JIRA_REDIRECT_URI missing from .env');
  }

  // REDIRECT_URI is a fixed value registered as-is in the Atlassian
  // app's callback list (Atlassian rejects anything else — no wildcard
  // support). If this page isn't actually being served from that exact
  // origin, sending the user through Atlassian's consent screen would
  // "succeed" there and then fail silently on the way back — Atlassian
  // redirects to a URL nothing here is listening on, with no error
  // surfaced anywhere. Catching the mismatch up front, before Atlassian
  // is ever involved, turns that into one clear, actionable message
  // (this only fires if vite.config.ts's pinned dev port and this env
  // var are ever changed independently of each other).
  const redirectOrigin = new URL(REDIRECT_URI).origin;
  if (window.location.origin !== redirectOrigin) {
    throw new Error(
      `This page is running at ${window.location.origin}, but Jira OAuth is configured for ` +
      `${redirectOrigin} (VITE_JIRA_REDIRECT_URI). Atlassian will only redirect back to the ` +
      `registered URL, so login would appear to silently fail. Open the app at ${redirectOrigin} instead.`,
    );
  }

  const verifier = randomString(64);
  const challenge = await codeChallengeFor(verifier);
  const state = randomString(32);

  sessionStorage.setItem(SS_PKCE_VERIFIER, verifier);
  sessionStorage.setItem(SS_OAUTH_STATE, state);
  sessionStorage.setItem(SS_RETURN_PATH, returnPath);

  const params = new URLSearchParams({
    audience: 'api.atlassian.com',
    client_id: CLIENT_ID,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    state,
    response_type: 'code',
    prompt: 'consent',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  window.location.href = `${AUTHORIZE_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface AccessibleResource {
  id: string;
  name: string;
  url: string;
  scopes: string[];
}

/**
 * Complete the flow after Atlassian redirects back to REDIRECT_URI with
 * ?code=...&state=.... Exchanges the code for a real access token (no
 * client secret — PKCE verifier proves this is the same client that
 * started the flow), resolves which real Jira site (cloudId) the user
 * granted access to, and returns the path to navigate back to.
 */
export async function handleCallback(searchParams: URLSearchParams): Promise<string> {
  // Clear transient PKCE/state/return-path up front, on every exit path
  // (including the early "Atlassian returned an error" one below) — a
  // denied-consent redirect used to skip this and leave stale entries
  // in sessionStorage until the next login overwrote them.
  const returnPath = sessionStorage.getItem(SS_RETURN_PATH) ?? '/';
  const expectedState = sessionStorage.getItem(SS_OAUTH_STATE);
  const verifier = sessionStorage.getItem(SS_PKCE_VERIFIER);
  sessionStorage.removeItem(SS_OAUTH_STATE);
  sessionStorage.removeItem(SS_PKCE_VERIFIER);
  sessionStorage.removeItem(SS_RETURN_PATH);

  const error = searchParams.get('error');
  if (error) {
    throw new Error(`Atlassian returned an error: ${error} — ${searchParams.get('error_description') ?? ''}`);
  }

  const code = searchParams.get('code');
  const returnedState = searchParams.get('state');

  if (!code || !returnedState || !expectedState || !verifier) {
    throw new Error('Missing code/state/verifier — this callback was not reached via login()');
  }
  if (returnedState !== expectedState) {
    throw new Error('OAuth state mismatch — possible CSRF, aborting');
  }
  if (!CLIENT_ID || !REDIRECT_URI) {
    throw new Error('Jira OAuth is not configured');
  }

  // Goes through our own backend (POST /api/jira/token), NOT Atlassian's
  // token endpoint directly — Atlassian requires client_secret on every
  // code-for-token exchange (no public-client PKCE support), and a
  // secret can never live in this frontend bundle. See routes/jira.py.
  // grant_type and client_id are the backend's job now, not sent here.
  const tokenRes = await fetch('/api/jira/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${body}`);
  }
  const token = await tokenRes.json() as TokenResponse;

  // Don't persist anything yet — isAuthenticated() only checks
  // token+expiry, so writing the token here before the site lookup
  // below is confirmed would leave a half-authenticated state (valid
  // token, no cloudId) if that lookup then throws. Resolve the site
  // first, and only write to sessionStorage once both have succeeded.
  const resourcesRes = await fetch(ACCESSIBLE_RESOURCES_URL, {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' },
  });
  if (!resourcesRes.ok) {
    const body = await resourcesRes.text();
    throw new Error(`Fetching accessible Jira sites failed (${resourcesRes.status}): ${body}`);
  }
  const resources = await resourcesRes.json() as AccessibleResource[];
  if (resources.length === 0) {
    throw new Error('Logged in, but this Atlassian account granted access to zero Jira sites');
  }
  // Resource-level access (see the app's Access type) is meant to grant
  // exactly one site per consent — but that's Atlassian's behavior, not
  // something this code enforces, so don't silently pick a site when
  // more than one comes back; that would attach to the wrong site with
  // no indication why ticket fetches then fail.
  if (resources.length > 1) {
    throw new Error(
      `This Atlassian login granted access to ${resources.length} Jira sites ` +
      `(${resources.map(r => r.name).join(', ')}) — only one site is supported right now. ` +
      'Re-authenticate and grant access to just the one site this app should use.',
    );
  }

  sessionStorage.setItem(SS_ACCESS_TOKEN, token.access_token);
  sessionStorage.setItem(SS_EXPIRES_AT, String(Date.now() + token.expires_in * 1000));
  sessionStorage.setItem(SS_CLOUD_ID, resources[0].id);
  sessionStorage.setItem(SS_SITE_NAME, resources[0].name);

  return returnPath;
}

export function isAuthenticated(): boolean {
  const token = sessionStorage.getItem(SS_ACCESS_TOKEN);
  const expiresAt = Number(sessionStorage.getItem(SS_EXPIRES_AT) ?? 0);
  return Boolean(token) && Date.now() < expiresAt;
}

// True when a token is stored but has passed its expiry — distinct from
// never having logged in at all. No offline_access/refresh token is
// requested (see this module's docstring), so this is a real, expected
// state after ~1 hour, not a bug — but without distinguishing it,
// JiraPanel's "logged-out" view looks identical to "never connected",
// which reads as Jira randomly failing rather than a session timing out.
export function isSessionExpired(): boolean {
  const token = sessionStorage.getItem(SS_ACCESS_TOKEN);
  const expiresAt = Number(sessionStorage.getItem(SS_EXPIRES_AT) ?? 0);
  return Boolean(token) && Date.now() >= expiresAt;
}

export function getAccessToken(): string | null {
  return isAuthenticated() ? sessionStorage.getItem(SS_ACCESS_TOKEN) : null;
}

export function getCloudId(): string | null {
  return isAuthenticated() ? sessionStorage.getItem(SS_CLOUD_ID) : null;
}

export function getSiteName(): string | null {
  return isAuthenticated() ? sessionStorage.getItem(SS_SITE_NAME) : null;
}

export function logout(): void {
  sessionStorage.removeItem(SS_ACCESS_TOKEN);
  sessionStorage.removeItem(SS_EXPIRES_AT);
  sessionStorage.removeItem(SS_CLOUD_ID);
  sessionStorage.removeItem(SS_SITE_NAME);
}
