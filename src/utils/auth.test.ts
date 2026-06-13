import { describe, it, expect } from 'vitest';
import { isBearerAuthorized } from './auth.js';

describe('isBearerAuthorized', () => {
  const token = 'secret-token-123';

  it('accepts a correct Bearer token', () => {
    expect(isBearerAuthorized(`Bearer ${token}`, token)).toBe(true);
  });

  it('is case-insensitive on the scheme', () => {
    expect(isBearerAuthorized(`bearer ${token}`, token)).toBe(true);
    expect(isBearerAuthorized(`BEARER ${token}`, token)).toBe(true);
  });

  it('tolerates surrounding and inter-token whitespace', () => {
    expect(isBearerAuthorized(`  Bearer    ${token}  `, token)).toBe(true);
  });

  it('rejects a wrong token of the same length', () => {
    expect(isBearerAuthorized('Bearer secret-token-124', token)).toBe(false);
  });

  it('rejects a token of a different length', () => {
    expect(isBearerAuthorized(`Bearer ${token}extra`, token)).toBe(false);
  });

  it('rejects a missing/empty header', () => {
    expect(isBearerAuthorized(undefined, token)).toBe(false);
    expect(isBearerAuthorized('', token)).toBe(false);
  });

  it('rejects a non-Bearer scheme', () => {
    expect(isBearerAuthorized(`Basic ${token}`, token)).toBe(false);
  });

  it('rejects a bare token without the scheme', () => {
    expect(isBearerAuthorized(token, token)).toBe(false);
  });

  it('rejects when no expected token is configured', () => {
    expect(isBearerAuthorized(`Bearer ${token}`, '')).toBe(false);
  });
});
