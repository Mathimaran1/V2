// SSO login handler skeleton — Azure AD (SAML 2.0) entry point.
//
// ANG-123: Implement user authentication with SSO. This is the request
// handler that will sit behind POST /auth/sso/login and GET
// /auth/sso/callback once wired into the real router. Token validation
// (JWKS) and session issuance are intentionally NOT implemented here yet
// — see tokenValidator.ts, added in a follow-up commit.

export interface SsoLoginRequest {
  /** Relative path to redirect to after a successful login. */
  redirectTo?: string;
}

export interface SsoLoginResult {
  /** Azure AD authorization URL the client should be redirected to. */
  redirectUrl: string;
  /** Opaque state value to verify on callback (CSRF protection). */
  state: string;
}

export interface SsoCallbackRequest {
  /** Authorization code returned by Azure AD. */
  code: string;
  /** State value echoed back, must match the one issued in the login step. */
  state: string;
}

const AZURE_AD_AUTHORIZE_ENDPOINT =
  'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';

/**
 * Builds the Azure AD authorization redirect for the SSO login flow.
 * Client ID / tenant / redirect URI are expected to come from config —
 * left as TODOs here since the real config module doesn't exist yet.
 */
export function buildSsoLoginRedirect(_req: SsoLoginRequest): SsoLoginResult {
  // TODO(ANG-123): pull clientId/tenantId/redirectUri from real config
  // once the config module lands. Hardcoded placeholders for now so the
  // shape of the handler is clear.
  const clientId = 'TODO_CLIENT_ID';
  const redirectUri = 'TODO_REDIRECT_URI';
  const state = generateState();

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: 'openid profile email',
    state,
  });

  return {
    redirectUrl: `${AZURE_AD_AUTHORIZE_ENDPOINT}?${params.toString()}`,
    state,
  };
}

/**
 * Handles the Azure AD callback. Not implemented yet — token exchange and
 * validation land in a follow-up commit (tokenValidator.ts).
 */
export function handleSsoCallback(_req: SsoCallbackRequest): never {
  throw new Error('Not implemented: token exchange (see tokenValidator.ts)');
}

function generateState(): string {
  // Placeholder — swap for a real CSPRNG (crypto.randomUUID or
  // crypto.randomBytes) before this handler is actually wired up.
  return Math.random().toString(36).slice(2);
}
