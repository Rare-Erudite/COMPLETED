/**
 * RARE — Artifact downloader
 *
 * Provisioning a runtime means fetching tens of megabytes of somebody else's
 * binary and then *executing* it. The download is therefore the trust boundary:
 * if a proxy, a captive portal or a truncated transfer can slip a different file
 * past this module, RARE would be running it.
 *
 * Everything here exists to make that impossible:
 *
 *   - HTTPS only. A plaintext or `file:` URL is refused before a byte moves.
 *   - The SHA-256 is computed *while streaming*, and the file is only moved to
 *     its final name after the digest matches. A partial or tampered transfer
 *     never reaches a path another module can execute.
 *   - The declared size is checked too. A checksum catches substitution; the
 *     size catches the far more common truncated transfer, and names it as
 *     such instead of reporting a confusing hash mismatch.
 *   - Disk space is checked against the *remaining* bytes before writing, so a
 *     full disk fails with `disk_space` rather than a half-written archive.
 *   - Transfers are cancellable and time-bounded, because provisioning runs
 *     inside a request.
 *
 * Deliberate limits, stated rather than hidden:
 *   - HTTP range/resume is not attempted. Upstream archives are served whole and
 *     a resumed transfer would need an `If-Range`-aware server; re-downloading
 *     is simpler and cannot produce a corrupt result.
 *   - No retry loop lives here. The caller owns retry policy so it can decide
 *     whether a second attempt is worth the bandwidth.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type DownloadFailureReason =
  | 'insecure_url'
  | 'http'
  | 'network'
  | 'timeout'
  | 'too_large'
  | 'disk_space'
  | 'checksum'
  | 'size'
  | 'cancelled'
  | 'write';

export interface DownloadRequest {
  url: string;
  /**
   * Lowercase hex SHA-256 the artifact must hash to. When omitted the download
   * still succeeds, but the caller receives no integrity guarantee — so every
   * adapter in this codebase supplies one.
   */
  sha256?: string;
  /** Expected byte length, when the publisher states one. */
  sizeBytes?: number;
  /** Hard ceiling. The transfer is aborted as soon as it is exceeded. */
  maxBytes?: number;
  /** Final path for the verified artifact. */
  destination: string;
  /** Whole-transfer budget. Default 10 minutes. */
  timeoutMs?: number;
  /** Cooperative cancellation, e.g. the caller's request was aborted. */
  signal?: AbortSignal;
  /** Progress callback, in bytes received. */
  onProgress?: (received: number, total?: number) => void;
}

export interface DownloadResult {
  ok: boolean;
  detail: string;
  reason?: DownloadFailureReason;
  filePath?: string;
  bytes?: number;
  sha256?: string;
}

const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/** Free space available to `targetPath`, in bytes. `undefined` when unknown. */
export function freeDiskBytes(targetPath: string): number | undefined {
  try {
    const stats = (fs as any).statfsSync(targetPath);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return undefined;
  }
}

function fail(reason: DownloadFailureReason, detail: string): DownloadResult {
  return { ok: false, reason, detail };
}

/**
 * Download `request.url` to `request.destination`, verifying size and SHA-256
 * before the file becomes visible under its final name.
 *
 * The write is atomic from the caller's point of view: the artifact is staged
 * as `<destination>.part` and renamed only on success, so a later `existsSync`
 * on the destination is real evidence the bytes were verified.
 */
export async function downloadArtifact(request: DownloadRequest): Promise<DownloadResult> {
  let parsed: URL;
  try {
    parsed = new URL(request.url);
  } catch {
    return fail('insecure_url', `"${request.url}" is not a valid URL.`);
  }

  // A runtime is code. It must not arrive over a channel a network attacker can
  // rewrite, and it must not be read off the local disk by a remote instruction.
  if (parsed.protocol !== 'https:') {
    return fail('insecure_url', `Refusing to fetch a runtime over "${parsed.protocol}" — HTTPS is required.`);
  }

  const maxBytes = request.maxBytes ?? DEFAULT_MAX_BYTES;
  const destination = request.destination;
  const staging = `${destination}.part`;

  try {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
  } catch (error: any) {
    return fail('write', `Cannot create ${path.dirname(destination)}: ${error?.message || error}`);
  }

  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  // Bridge the caller's cancellation into our controller so both paths unwind
  // the same way and the staging file is always cleaned up.
  let cancelled = false;
  const onExternalAbort = () => {
    cancelled = true;
    controller.abort();
  };
  if (request.signal) {
    if (request.signal.aborted) {
      clearTimeout(timer);
      return fail('cancelled', 'The download was cancelled before it started.');
    }
    request.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  let handle: fs.promises.FileHandle | undefined;
  try {
    const response = await fetch(parsed, { redirect: 'follow', signal: controller.signal });
    if (!response.ok || !response.body) {
      return fail('http', `HTTP ${response.status} ${response.statusText} from ${parsed.host}`);
    }

    // The publisher's Content-Length is a hint we can pre-flight against. If it
    // already exceeds the ceiling there is no reason to spend the bandwidth.
    const declaredHeader = Number(response.headers.get('content-length') || 0);
    if (declaredHeader && declaredHeader > maxBytes) {
      return fail('too_large', `Artifact is ${declaredHeader} bytes, above the ${maxBytes} byte limit.`);
    }

    const total = request.sizeBytes || declaredHeader || undefined;
    const free = freeDiskBytes(path.dirname(destination));
    if (free !== undefined && total && free < total) {
      return fail(
        'disk_space',
        `Only ${Math.floor(free / 1024 / 1024)} MB free, but the artifact needs ${Math.ceil(total / 1024 / 1024)} MB.`,
      );
    }

    handle = await fs.promises.open(staging, 'w');
    const hash = crypto.createHash('sha256');
    const reader = response.body.getReader();
    let received = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        return fail('too_large', `The transfer passed the ${maxBytes} byte limit and was aborted.`);
      }
      hash.update(value);
      await handle.write(Buffer.from(value));
      request.onProgress?.(received, total);
    }

    await handle.close();
    handle = undefined;

    if (total && received !== total) {
      return fail('size', `Transfer ended early: received ${received} bytes, expected ${total}.`);
    }
    if (request.sizeBytes && received !== request.sizeBytes) {
      return fail('size', `Size mismatch: received ${received} bytes, the publisher declares ${request.sizeBytes}.`);
    }

    const digest = hash.digest('hex');
    if (request.sha256 && digest.toLowerCase() !== request.sha256.toLowerCase()) {
      return fail(
        'checksum',
        `SHA-256 mismatch: got ${digest.slice(0, 16)}…, expected ${request.sha256.slice(0, 16)}…. The artifact was discarded.`,
      );
    }

    // Rename last: the destination path implies "verified" to every other module.
    if (fs.existsSync(destination)) fs.rmSync(destination, { force: true });
    fs.renameSync(staging, destination);

    return {
      ok: true,
      filePath: destination,
      bytes: received,
      sha256: digest,
      detail: `${received} bytes, SHA-256 ${digest.slice(0, 16)}…`,
    };
  } catch (error: any) {
    if (timedOut) return fail('timeout', `Download exceeded ${Math.round(timeoutMs / 1000)}s and was aborted.`);
    if (cancelled) return fail('cancelled', 'The download was cancelled.');
    const message = error?.message || String(error);
    return fail('network', `Download failed: ${message}`);
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', onExternalAbort);
    if (handle) {
      try {
        await handle.close();
      } catch {
        // Already closed or never opened; the staging cleanup below still runs.
      }
    }
    // A failed or cancelled transfer must never leave a `.part` file behind:
    // a stale staging file would be picked up by a later run as a cache hit.
    if (fs.existsSync(staging)) {
      try {
        fs.rmSync(staging, { force: true });
      } catch {
        // Best effort. The name is unique per artifact, so a leftover cannot be
        // mistaken for a verified download.
      }
    }
  }
}

/**
 * Fetch a small text document — a checksum manifest, a version index — with the
 * same HTTPS-only rule. Kept separate from `downloadArtifact` because a
 * manifest has no checksum of its own; it *is* the trust anchor for the
 * artifact, so it is fetched over TLS from the publisher's own host.
 */
export async function fetchText(url: string, timeoutMs = 30_000): Promise<{ ok: boolean; text?: string; detail: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, detail: `"${url}" is not a valid URL.` };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, detail: `Refusing to fetch "${parsed.protocol}" — HTTPS is required.` };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(parsed, { redirect: 'follow', signal: controller.signal });
    if (!response.ok) {
      return { ok: false, detail: `HTTP ${response.status} ${response.statusText} from ${parsed.host}` };
    }
    return { ok: true, text: await response.text(), detail: 'ok' };
  } catch (error: any) {
    return { ok: false, detail: error?.message || String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract a lowercase hex SHA-256 for `filename` from a `sha256sum`-style
 * manifest (`<hex>  <name>`), the format nodejs.org and python-build-standalone
 * both publish.
 *
 * Returns `undefined` when the manifest does not mention the file — which the
 * caller must treat as "no checksum available", never as "no checksum needed".
 */
export function checksumFromManifest(manifest: string, filename: string): string | undefined {
  for (const rawLine of manifest.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    // Accept both "<hex>  <name>" and "<hex> *<name>" (binary-mode marker).
    const match = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (!match) continue;
    const [, digest, name] = match;
    if (name.trim() === filename) return digest.toLowerCase();
  }
  return undefined;
}
