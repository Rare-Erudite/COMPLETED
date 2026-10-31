/**
 * SafeFetcher — the single outbound HTTP path for user-supplied URLs.
 *
 * This is the DNS-pinned SSRF guard that previously lived inside
 * DocumentStore.fetchPublicHttps, lifted out so the content engine, the
 * research engine and the document importer all share ONE implementation
 * instead of three drifting copies.
 *
 * Guarantees:
 *  - https: only, no embedded credentials, no dangerous schemes
 *  - hostname blocklist (localhost/.local/.internal/cloud metadata names)
 *  - every resolved address must be public; the validated address is PINNED
 *    into the socket lookup so a second DNS answer cannot rebind to a private IP
 *  - redirects are followed manually and REVALIDATED at every hop
 *  - hard byte cap, wall-clock timeout, redirect cap
 *  - response body is returned as a Buffer so binary formats survive
 */

import dns from 'dns/promises';
import https from 'https';
import { isIP } from 'net';

export interface SafeFetchOptions {
  /** Maximum bytes to read. Defaults to 8 MB. */
  maxBytes?: number;
  /** Per-request timeout in ms. Defaults to 15s. */
  timeoutMs?: number;
  /** Maximum redirects to follow. Defaults to 4. */
  maxRedirects?: number;
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** Accept header override. */
  accept?: string;
}

export interface SafeFetchResult {
  /** Final URL after redirects. */
  finalUrl: string;
  status: number;
  headers: Record<string, string | string[] | undefined>;
  contentType: string;
  body: Buffer;
  /** Every URL visited, in order (original first). */
  redirectChain: string[];
  truncated: boolean;
}

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 4;

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan', '.intranet'];
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  '169.254.169.254',
]);

export class SafeFetchError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

/** True when the address is loopback/private/link-local/CGNAT/multicast/reserved. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    return (
      parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      parts[0] >= 224 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && (parts[1] === 168 || parts[1] === 0 || (parts[1] === 88 && parts[2] === 99))) ||
      (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19 || (parts[1] === 51 && parts[2] === 100))) ||
      (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    );
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith('::ffff:')) return isPrivateAddress(normalized.slice('::ffff:'.length));
    // Accept only global-unicast IPv6 (2000::/3); exclude documentation and
    // special-use allocations. This rejects ULA, link-local, multicast,
    // loopback and unspecified addresses by default.
    const first = Number.parseInt(normalized.split(':', 1)[0] || '0', 16);
    return (
      (first & 0xe000) !== 0x2000 ||
      normalized.startsWith('2001:db8:') ||
      normalized.startsWith('2001:10:') ||
      normalized.startsWith('2001:2:')
    );
  }
  return true;
}

/** Validate a URL for outbound retrieval. Throws SafeFetchError when unsafe. */
export function assertSafeUrl(rawUrl: string | URL): URL {
  let target: URL;
  try {
    target = typeof rawUrl === 'string' ? new URL(rawUrl) : new URL(rawUrl.toString());
  } catch {
    throw new SafeFetchError('That is not a valid URL.', 'INVALID_URL');
  }
  if (target.protocol !== 'https:') {
    throw new SafeFetchError('Only public HTTPS URLs can be retrieved.', 'UNSAFE_SCHEME');
  }
  if (target.username || target.password) {
    throw new SafeFetchError('URLs with embedded credentials are not allowed.', 'EMBEDDED_CREDENTIALS');
  }
  const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) throw new SafeFetchError('The URL has no hostname.', 'INVALID_URL');
  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new SafeFetchError('Private and local addresses are not allowed.', 'PRIVATE_ADDRESS');
  }
  if (isIP(hostname) && isPrivateAddress(hostname)) {
    throw new SafeFetchError('Private and local addresses are not allowed.', 'PRIVATE_ADDRESS');
  }
  return target;
}

async function resolvePublicAddress(hostname: string): Promise<{ address: string; family: number }> {
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new SafeFetchError('Private and local addresses are not allowed.', 'PRIVATE_ADDRESS');
    return { address: hostname, family: isIP(hostname) };
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SafeFetchError(`Could not resolve ${hostname}.`, 'DNS_FAILURE');
  }
  if (addresses.length === 0) throw new SafeFetchError(`Could not resolve ${hostname}.`, 'DNS_FAILURE');
  if (addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new SafeFetchError('Private and local addresses are not allowed.', 'PRIVATE_ADDRESS');
  }
  return addresses[0];
}

function requestOnce(
  target: URL,
  pinned: { address: string; family: number },
  options: Required<Pick<SafeFetchOptions, 'maxBytes' | 'timeoutMs'>> & SafeFetchOptions,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer; truncated: boolean }> {
  const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;
    let truncated = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const request = https.request(
      {
        protocol: 'https:',
        hostname,
        port: target.port ? Number(target.port) : 443,
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        servername: isIP(hostname) ? undefined : hostname,
        headers: {
          Accept: options.accept || 'text/html,application/xhtml+xml,application/pdf,text/plain,application/json;q=0.9,*/*;q=0.8',
          'Accept-Encoding': 'identity',
          'User-Agent': 'RARE-ContentEngine/1.0 (+https://rare-erudite.com)',
          ...(options.headers || {}),
        },
        // Pin the validated address: a second lookup cannot rebind to a private IP.
        // Node 20 enables autoSelectFamily, which calls lookup with { all: true }
        // and expects an address ARRAY; older paths expect (address, family).
        lookup: ((_host: string, lookupOptions: any, callback: any) => {
          if (lookupOptions && lookupOptions.all) {
            callback(null, [{ address: pinned.address, family: pinned.family }]);
            return;
          }
          callback(null, pinned.address, pinned.family);
        }) as any,
        rejectUnauthorized: true,
      },
      (response) => {
        response.on('data', (chunk: Buffer | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          if (totalBytes + bytes.byteLength > options.maxBytes) {
            const remaining = Math.max(0, options.maxBytes - totalBytes);
            if (remaining > 0) chunks.push(bytes.subarray(0, remaining));
            totalBytes = options.maxBytes;
            truncated = true;
            response.destroy();
            finish(() =>
              resolve({
                status: response.statusCode || 0,
                headers: response.headers,
                body: Buffer.concat(chunks),
                truncated,
              }),
            );
            return;
          }
          totalBytes += bytes.byteLength;
          chunks.push(bytes);
        });
        response.on('end', () =>
          finish(() =>
            resolve({
              status: response.statusCode || 0,
              headers: response.headers,
              body: Buffer.concat(chunks),
              truncated,
            }),
          ),
        );
        response.on('error', (error) => finish(() => reject(error)));
      },
    );

    request.setTimeout(options.timeoutMs, () => request.destroy(new SafeFetchError('The source timed out.', 'TIMEOUT')));
    request.on('error', (error) => finish(() => reject(error)));
    request.end();
  });
}

/**
 * Retrieve a public HTTPS resource with SSRF protection, redirect revalidation
 * and byte/time budgets. Returns the raw bytes plus provenance.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  let target = assertSafeUrl(rawUrl);
  const redirectChain: string[] = [target.toString()];

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const pinned = await resolvePublicAddress(target.hostname.toLowerCase().replace(/^\[|\]$/g, ''));
    const response = await requestOnce(target, pinned, { ...options, maxBytes, timeoutMs });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.location;
      const locationValue = Array.isArray(location) ? location[0] : location;
      if (!locationValue) throw new SafeFetchError('The source redirected without a destination.', 'BAD_REDIRECT');
      if (hop === maxRedirects) throw new SafeFetchError('The source redirected too many times.', 'TOO_MANY_REDIRECTS');
      // Revalidate the redirect target from scratch: scheme, host, DNS.
      target = assertSafeUrl(new URL(locationValue, target).toString());
      redirectChain.push(target.toString());
      continue;
    }

    const contentTypeHeader = response.headers['content-type'];
    const contentType = String(Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader || '');
    return {
      finalUrl: target.toString(),
      status: response.status,
      headers: response.headers,
      contentType,
      body: response.body,
      redirectChain,
      truncated: response.truncated,
    };
  }

  throw new SafeFetchError('The source redirected too many times.', 'TOO_MANY_REDIRECTS');
}
