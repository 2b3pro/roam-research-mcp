import { describe, it, expect } from 'vitest';
import { hostnameOf, rebindingRefusal } from './host-validation.js';

describe('hostnameOf', () => {
  it('drops the port, IPv6 brackets, case and a trailing dot', () => {
    expect(hostnameOf('Example.COM:8088')).toBe('example.com');
    expect(hostnameOf('[::1]:8088')).toBe('::1');
    expect(hostnameOf('localhost.')).toBe('localhost');
    expect(hostnameOf(' roam-mcp ')).toBe('roam-mcp');
  });
});

describe('rebindingRefusal', () => {
  const refusal = (host?: string, origin?: string, method = 'POST') =>
    rebindingRefusal({ method, headers: { host, origin } }, ['roam-mcp'], ['https://roamresearch.com']);

  it('passes localhost, IP addresses, listed names, and a missing Host', () => {
    for (const host of ['localhost:8088', '127.0.0.1:8088', '10.0.0.5', '[::1]:8088', 'roam-mcp:8048', undefined]) {
      expect(refusal(host), String(host)).toBeNull();
    }
  });

  it('refuses any other hostname, including ones that resolve to loopback', () => {
    for (const host of ['evil.example:8088', 'localhost.evil.example', '127.0.0.1.nip.io:8088']) {
      expect(refusal(host), host).toMatch(/HTTP_ALLOWED_HOSTS/);
    }
  });

  it('refuses an Origin outside CORS_ORIGIN, except on a preflight', () => {
    expect(refusal('localhost', 'http://evil.example')).toMatch(/CORS_ORIGIN/);
    expect(refusal('localhost', 'http://evil.example', 'OPTIONS')).toBeNull();
    expect(refusal('localhost', 'https://roamresearch.com')).toBeNull();
  });

  it('lets CORS_ORIGIN=* allow any Origin', () => {
    expect(rebindingRefusal({ method: 'POST', headers: { host: 'localhost', origin: 'http://any.example' } }, [], ['*'])).toBeNull();
  });
});
