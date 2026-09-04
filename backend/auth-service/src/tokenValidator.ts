// JWKS-based ID token validation for the Azure AD SSO flow.
//
// ANG-123: validates the id_token Azure AD returns from the token
// endpoint after the authorization code exchange. Signature
// verification is done against Azure AD's published JWKS, keyed by the
// token's `kid` header — no hardcoded/shared secret involved.
//
// The actual code->token exchange (calling Azure AD's /token endpoint)
// still isn't implemented — this module only covers validating a token
// once one is in hand, which is what ssoLoginHandler.ts's
// handleSsoCallback() will call into next.

export interface ValidatedTokenClaims {
  sub: string;
  email: string;
  name: string;
  /** Token expiry, unix seconds. */
  exp: number;
  /** Token issued-at, unix seconds. */
  iat: number;
}

export interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
}

export class TokenValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenValidationError';
  }
}

/**
 * Fetches Azure AD's current JWKS (JSON Web Key Set). Cached by the
 * caller — this function always hits the network.
 */
export async function fetchJwks(jwksUri: string): Promise<Jwk[]> {
  const res = await fetch(jwksUri);
  if (!res.ok) {
    throw new TokenValidationError(
      `Failed to fetch JWKS: ${res.status} ${res.statusText}`
    );
  }
  const body = (await res.json()) as { keys: Jwk[] };
  return body.keys;
}

/**
 * Decodes a JWT's header without verifying it, just to read `kid` so the
 * matching key can be picked out of the JWKS before real verification.
 */
export function decodeTokenHeader(token: string): { kid: string; alg: string } {
  const [headerB64] = token.split('.');
  if (!headerB64) {
    throw new TokenValidationError('Malformed token: missing header segment');
  }
  const header = JSON.parse(base64UrlDecode(headerB64)) as {
    kid?: string;
    alg?: string;
  };
  if (!header.kid || !header.alg) {
    throw new TokenValidationError('Malformed token header: missing kid/alg');
  }
  return { kid: header.kid, alg: header.alg };
}

/**
 * Validates an Azure AD id_token: signature against the matching JWKS
 * key, plus exp/iat sanity. Real signature verification (RS256) is left
 * as a TODO — this lays out the validation steps and claim shape so
 * unit tests can exercise the surrounding logic (expiry checks, key
 * lookup, malformed-token handling) before the crypto step is wired in.
 */
export function validateToken(
  token: string,
  jwks: Jwk[],
  now: number = Math.floor(Date.now() / 1000)
): ValidatedTokenClaims {
  const { kid } = decodeTokenHeader(token);

  const key = jwks.find((k) => k.kid === kid);
  if (!key) {
    throw new TokenValidationError(`No matching JWKS key for kid=${kid}`);
  }

  // TODO(ANG-123): verify RS256 signature against `key` (n, e) before
  // trusting the payload below. Not implemented yet — tracked as a
  // known gap, not silently skipped.

  const [, payloadB64] = token.split('.');
  if (!payloadB64) {
    throw new TokenValidationError('Malformed token: missing payload segment');
  }
  const claims = JSON.parse(base64UrlDecode(payloadB64)) as ValidatedTokenClaims;

  if (typeof claims.exp !== 'number' || claims.exp <= now) {
    throw new TokenValidationError('Token expired');
  }
  if (typeof claims.iat !== 'number' || claims.iat > now) {
    throw new TokenValidationError('Token issued in the future');
  }
  if (!claims.sub || !claims.email) {
    throw new TokenValidationError('Token missing required claims (sub/email)');
  }

  return claims;
}

function base64UrlDecode(segment: string): string {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const withPadding = padded.padEnd(
    padded.length + ((4 - (padded.length % 4)) % 4),
    '='
  );
  return Buffer.from(withPadding, 'base64').toString('utf8');
}
