// Unit tests for tokenValidator.ts — ANG-123.
//
// No test runner is wired into this repo yet (no package.json/jest
// config under backend/auth-service/), so these are written against a
// plain describe/it/expect shape that any standard runner (Jest,
// Vitest) picks up once the harness is added — tracked as a follow-up,
// not silently skipped. The point of this commit is real, exercisable
// test *cases* for the validation logic that already exists, not test
// infrastructure.

import {
  decodeTokenHeader,
  validateToken,
  TokenValidationError,
  type Jwk,
} from '../src/tokenValidator';

function base64UrlEncode(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function makeToken(header: object, payload: object): string {
  return `${base64UrlEncode(header)}.${base64UrlEncode(payload)}.fakesig`;
}

const KID = 'test-key-1';
const JWKS: Jwk[] = [{ kid: KID, kty: 'RSA', n: 'fake-n', e: 'AQAB' }];

describe('decodeTokenHeader', () => {
  it('reads kid and alg from a well-formed header', () => {
    const token = makeToken({ kid: KID, alg: 'RS256' }, { sub: 'x' });
    expect(decodeTokenHeader(token)).toEqual({ kid: KID, alg: 'RS256' });
  });

  it('throws on a token with no segments at all', () => {
    expect(() => decodeTokenHeader('not-a-jwt')).toThrow(TokenValidationError);
  });

  it('throws when the header is missing kid', () => {
    const token = makeToken({ alg: 'RS256' }, { sub: 'x' });
    expect(() => decodeTokenHeader(token)).toThrow(TokenValidationError);
  });
});

describe('validateToken', () => {
  const now = 1_700_000_000;

  it('returns claims for a valid, unexpired token with a matching kid', () => {
    const token = makeToken(
      { kid: KID, alg: 'RS256' },
      {
        sub: 'user-123',
        email: 'rohit@example.com',
        name: 'Rohit Sharma',
        iat: now - 60,
        exp: now + 3600,
      }
    );
    const claims = validateToken(token, JWKS, now);
    expect(claims.sub).toBe('user-123');
    expect(claims.email).toBe('rohit@example.com');
  });

  it('rejects a token whose kid has no matching JWKS entry', () => {
    const token = makeToken(
      { kid: 'unknown-kid', alg: 'RS256' },
      { sub: 'user-123', email: 'rohit@example.com', iat: now - 60, exp: now + 3600 }
    );
    expect(() => validateToken(token, JWKS, now)).toThrow(
      /No matching JWKS key/
    );
  });

  it('rejects an expired token', () => {
    const token = makeToken(
      { kid: KID, alg: 'RS256' },
      { sub: 'user-123', email: 'rohit@example.com', iat: now - 7200, exp: now - 3600 }
    );
    expect(() => validateToken(token, JWKS, now)).toThrow(/expired/);
  });

  it('rejects a token issued in the future', () => {
    const token = makeToken(
      { kid: KID, alg: 'RS256' },
      { sub: 'user-123', email: 'rohit@example.com', iat: now + 3600, exp: now + 7200 }
    );
    expect(() => validateToken(token, JWKS, now)).toThrow(
      /issued in the future/
    );
  });

  it('rejects a token missing required claims', () => {
    const token = makeToken(
      { kid: KID, alg: 'RS256' },
      { iat: now - 60, exp: now + 3600 } // no sub/email
    );
    expect(() => validateToken(token, JWKS, now)).toThrow(
      /missing required claims/
    );
  });
});
