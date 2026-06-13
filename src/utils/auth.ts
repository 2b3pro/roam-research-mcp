import { timingSafeEqual } from 'node:crypto';

/**
 * Validate an HTTP `Authorization` header against an expected bearer token.
 *
 * Uses a constant-time comparison so the token can't be recovered via response
 * timing. Returns true only when the header is exactly `Bearer <token>` (scheme
 * is case-insensitive; surrounding whitespace tolerated) and matches.
 *
 * This is transport-level AUTHENTICATION (who may talk to the server) — distinct
 * from ROAM_SYSTEM_WRITE_KEY, which is per-graph write AUTHORIZATION.
 */
export function isBearerAuthorized(
  authHeader: string | undefined,
  expectedToken: string
): boolean {
  if (!authHeader || !expectedToken) return false;

  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match) return false;

  const provided = Buffer.from(match[1]);
  const expected = Buffer.from(expectedToken);

  // Length is not secret; guard first because timingSafeEqual throws on mismatch.
  if (provided.length !== expected.length) return false;

  return timingSafeEqual(provided, expected);
}
