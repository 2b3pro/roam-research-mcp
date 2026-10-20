import { isIP } from 'node:net';

/**
 * DNS-rebinding checks for an HTTP server running WITHOUT a bearer token.
 *
 * A web page can point its own hostname at 127.0.0.1 after it loads. The
 * browser then treats this server as same-origin, so CORS never applies and
 * the page can call every tool. Two headers still give it away: `Host` carries
 * the page's hostname rather than one this server answers to, and `Origin`
 * names the page. With a token set none of this is needed: the page cannot
 * authenticate.
 */

/**
 * The hostname in a Host header or an allow-list entry: port and IPv6
 * brackets removed, lowercased, trailing dot dropped.
 */
export function hostnameOf(host: string): string {
  const value = host.trim().toLowerCase();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end === -1 ? value : value.slice(1, end);
  }
  const colon = value.lastIndexOf(':');
  return (colon === -1 ? value : value.slice(0, colon)).replace(/\.$/, '');
}

/**
 * `localhost` and IP addresses always pass: a rebinding page can only put a
 * hostname it controls in the header, never an IP. Anything else must be
 * listed. A missing Host passes too, since every browser sends one.
 */
function isAllowedHost(host: string | undefined, allowedHosts: readonly string[]): boolean {
  if (!host) return true;
  const name = hostnameOf(host);
  return name === 'localhost' || isIP(name) !== 0 || allowedHosts.includes(name);
}

/** No Origin (not a browser, or a same-origin GET), or one CORS_ORIGIN allows. */
function isAllowedOrigin(origin: string | undefined, corsOrigins: readonly string[]): boolean {
  if (!origin) return true;
  return corsOrigins.includes('*') || corsOrigins.includes(origin);
}

/**
 * Why a request to a server without a bearer token must be refused, or null if
 * it may be answered. Preflights skip the Origin check: the CORS headers
 * already decide what a browser may do after one.
 */
export function rebindingRefusal(
  req: { method?: string; headers: { host?: string; origin?: string } },
  allowedHosts: readonly string[],
  corsOrigins: readonly string[]
): string | null {
  const { host, origin } = req.headers;
  if (!isAllowedHost(host, allowedHosts)) {
    return `Host ${JSON.stringify(host)} is not allowed: add its name to HTTP_ALLOWED_HOSTS, or set HTTP_AUTH_TOKEN`;
  }
  if (req.method !== 'OPTIONS' && !isAllowedOrigin(origin, corsOrigins)) {
    return `Origin ${JSON.stringify(origin)} is not allowed: add it to CORS_ORIGIN, or set HTTP_AUTH_TOKEN`;
  }
  return null;
}
