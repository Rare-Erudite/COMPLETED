/**
 * RARE — Update activation
 *
 * `UpdateModal` downloads an artifact and verifies its SHA-256, then called
 * `onApplyUpdate` that nothing listened to, against a `/api/updates/apply`
 * endpoint that answered 501. The download worked; activation never existed.
 *
 * This module implements the part RARE can honestly do per platform, and — just
 * as importantly — the part it must not pretend to do:
 *
 *   web       The running bundle *is* the deployment. There is no artifact to
 *             install; activation means loading the new build. The honest
 *             answer is `reload_required`, and the client performs it.
 *   android   Installing an APK needs a user grant through the OS package
 *             installer. RARE can hand over the verified file; it cannot and
 *             must not claim to have installed it.
 *   windows   An exe/msi needs elevation and an OS-level updater. Same rule.
 *
 * States are strictly ordered and never skipped:
 *   discovered → downloaded → verified → activation_pending → activated
 * with `failed` reachable from any stage. A caller that reports "installed"
 * because a byte arrived is lying to its user, so `activated` is only ever set
 * by an operation that then re-read the resulting state.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { AppUpdate } from '../storage/UpdateStore.js';

export type ActivationStage =
  | 'discovered'
  | 'downloaded'
  | 'verified'
  | 'activation_pending'
  | 'activated'
  | 'failed';

export type Platform = 'web' | 'android' | 'windows';

/** What the client must do after RARE has done everything it can. */
export type ActivationAction =
  | 'none'                      // activated by RARE
  | 'reload_required'           // web: refresh to load the new bundle
  | 'user_install_required'     // android: OS package installer
  | 'user_elevation_required'   // windows: requires elevation
  | 'unsupported';              // no honest mechanism exists

export interface ActivationResult {
  updateId: string;
  platform: Platform;
  stage: ActivationStage;
  action: ActivationAction;
  /** True only when the running system is demonstrably on the new version. */
  activated: boolean;
  /** What the user sees; never claims more than happened. */
  message: string;
  /** Verified artifact path, when one was written. */
  artifactPath?: string;
  /** True when the checksum matched the published value. */
  checksumVerified: boolean;
  /** Restored from this version when an activation failed, if applicable. */
  rolledBackTo?: string;
  /** Machine-readable detail for the UI and the audit log. */
  details: Record<string, unknown>;
}

export interface VerifyOptions {
  /** Directory to write the artifact into. Must be writable and disposable. */
  downloadDir: string;
  /** Fetches the bytes. Injected so tests can supply a local, deterministic body. */
  fetchBytes?: (url: string) => Promise<Buffer>;
  /** Largest acceptable artifact, in bytes. */
  maxBytes?: number;
}

/** Value a browser/OS reports for the app that is actually running. */
export interface RunningState {
  version: string;
  /** Platform-reported build identity, when available. */
  buildId?: string;
}

export function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Download and verify the exact artifact. Returns a stage of `verified` only
 * when the bytes on disk hash to the published checksum.
 *
 * Two independent checks run: the published size (cheap, catches a truncated or
 * wrong-file response) and the SHA-256 (catches substitution). Neither alone is
 * sufficient — a proxy error page can match a size but not a hash.
 */
export async function downloadAndVerify(
  update: AppUpdate,
  options: VerifyOptions,
): Promise<ActivationResult> {
  const base: Omit<ActivationResult, 'stage' | 'message' | 'checksumVerified' | 'details'> = {
    updateId: update.id,
    platform: (update.platform || 'web') as Platform,
    action: 'none',
    activated: false,
  };

  if (!update.packageUrl) {
    return {
      ...base,
      stage: 'failed',
      checksumVerified: false,
      message: 'This release has no artifact URL to download.',
      details: { reason: 'missing_package_url' },
    };
  }
  if (!update.sha256) {
    return {
      ...base,
      stage: 'failed',
      checksumVerified: false,
      message: 'This release has no published checksum, so the download cannot be trusted.',
      details: { reason: 'missing_checksum' },
    };
  }

  const maxBytes = options.maxBytes ?? 512 * 1024 * 1024;
  let bytes: Buffer;
  try {
    const fetchFn = options.fetchBytes || defaultFetch;
    bytes = await fetchFn(update.packageUrl);
  } catch (error: any) {
    return {
      ...base,
      stage: 'failed',
      checksumVerified: false,
      message: `Download failed: ${error?.message || String(error)}`,
      details: { reason: 'download_failed' },
    };
  }

  if (bytes.length > maxBytes) {
    return {
      ...base,
      stage: 'failed',
      checksumVerified: false,
      message: `Artifact is ${bytes.length} bytes, above the ${maxBytes} byte limit.`,
      details: { reason: 'too_large', bytes: bytes.length },
    };
  }

  // Size check first: it explains truncated transfers better than a hash mismatch.
  if (typeof update.artifactSizeBytes === 'number' && update.artifactSizeBytes > 0
      && bytes.length !== update.artifactSizeBytes) {
    return {
      ...base,
      stage: 'failed',
      checksumVerified: false,
      message: `Size mismatch: received ${bytes.length} bytes, release declares ${update.artifactSizeBytes}.`,
      details: { reason: 'size_mismatch', expected: update.artifactSizeBytes, received: bytes.length },
    };
  }

  const actual = sha256(bytes);
  if (actual.toLowerCase() !== update.sha256.toLowerCase()) {
    return {
      ...base,
      stage: 'failed',
      checksumVerified: false,
      message: 'Checksum mismatch: the downloaded file is not the published release.',
      details: { reason: 'checksum_mismatch', expected: update.sha256, actual },
    };
  }

  // Persist only after verification, so an unverified payload never becomes a
  // file the OS could be pointed at.
  let artifactPath: string | undefined;
  try {
    fs.mkdirSync(options.downloadDir, { recursive: true });
    const safeName = path.basename(new URL(update.packageUrl).pathname) || `${update.id}.bin`;
    artifactPath = path.join(options.downloadDir, `${update.id}-${safeName}`);
    fs.writeFileSync(artifactPath, bytes);
    const onDisk = fs.readFileSync(artifactPath);
    if (onDisk.length !== bytes.length || sha256(onDisk) !== actual) {
      fs.rmSync(artifactPath, { force: true });
      return {
        ...base,
        stage: 'failed',
        checksumVerified: false,
        message: 'The artifact changed while being written to disk; it was discarded.',
        details: { reason: 'write_corruption' },
      };
    }
  } catch (error: any) {
    return {
      ...base,
      stage: 'failed',
      checksumVerified: false,
      message: `Verified in memory but could not be stored: ${error?.message || String(error)}`,
      details: { reason: 'write_failed' },
    };
  }

  return {
    ...base,
    stage: 'verified',
    checksumVerified: true,
    artifactPath,
    message: `Artifact verified (SHA-256 ${actual.slice(0, 12)}…, ${bytes.length} bytes).`,
    details: { bytes: bytes.length, sha256: actual },
  };
}

/** Default fetch: HTTPS only, bounded by the caller's maxBytes. */
async function defaultFetch(url: string): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new Error('Updates must be downloaded over HTTPS.');
  }
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Activate a verified artifact for `platform`.
 *
 * `running` is what the platform reports about the *current* process. For web,
 * activation is only real once the running build differs from the target — a
 * reload the user has not done yet is not an installation.
 */
export async function activate(
  update: AppUpdate,
  verified: ActivationResult,
  options: {
    platform?: Platform;
    running: RunningState;
    /** Web only: a callback that performs the reload, if the host can. */
    requestReload?: () => void;
    /** Android/Windows: hand the verified file to the OS installer. */
    handOffToOs?: (artifactPath: string) => Promise<{ ok: boolean; detail: string }>;
  },
): Promise<ActivationResult> {
  const platform = options.platform || (update.platform as Platform) || 'web';

  if (verified.stage !== 'verified') {
    return {
      ...verified,
      platform,
      stage: 'failed',
      activated: false,
      message: `Cannot activate: the artifact never passed verification (${verified.stage}).`,
      details: { ...verified.details, reason: 'not_verified' },
    };
  }

  // ---- Web ---------------------------------------------------------------
  // The deployed bundle is the application. There is no file to swap; the
  // honest outcome is that a reload is required and has not happened yet.
  if (platform === 'web') {
    const alreadyCurrent = options.running.version === update.version;
    if (alreadyCurrent) {
      return {
        ...verified,
        platform,
        stage: 'activated',
        action: 'none',
        activated: true,
        message: `Already running ${update.version}.`,
        details: { ...verified.details, runningVersion: options.running.version },
      };
    }

    if (options.requestReload) {
      try {
        options.requestReload();
      } catch {
        // A failed reload request is not an activation; fall through.
      }
    }

    return {
      ...verified,
      platform,
      stage: 'activation_pending',
      action: 'reload_required',
      activated: false,
      message: `Version ${update.version} is ready. Reload the page to load it — RARE cannot verify the new bundle until the reload happens.`,
      details: {
        ...verified.details,
        runningVersion: options.running.version,
        targetVersion: update.version,
      },
    };
  }

  // ---- Android -----------------------------------------------------------
  // An APK install is granted by the user in the OS package installer. Anything
  // this server reports beyond "handed it to the OS" would be a fabrication.
  if (platform === 'android') {
    if (!options.handOffToOs) {
      return {
        ...verified,
        platform,
        stage: 'activation_pending',
        action: 'user_install_required',
        activated: false,
        message: `Version ${update.version} downloaded and verified. Android will ask you to allow the install; RARE cannot install it silently.`,
        details: { ...verified.details, requiresUserGrant: true },
      };
    }
    const handoff = await options.handOffToOs(verified.artifactPath!);
    return {
      ...verified,
      platform,
      stage: handoff.ok ? 'activation_pending' : 'failed',
      action: 'user_install_required',
      activated: false,
      message: handoff.ok
        ? `Android package installer opened for ${update.version}. The install completes only after you confirm it.`
        : `Android could not open the installer: ${handoff.detail}`,
      details: { ...verified.details, handoff: handoff.detail },
    };
  }

  // ---- Windows -----------------------------------------------------------
  if (platform === 'windows') {
    if (!options.handOffToOs) {
      return {
        ...verified,
        platform,
        stage: 'activation_pending',
        action: 'user_elevation_required',
        activated: false,
        message: `Version ${update.version} downloaded and verified. Running the installer requires elevation, which RARE will not request on your behalf.`,
        details: { ...verified.details, requiresElevation: true },
      };
    }
    const handoff = await options.handOffToOs(verified.artifactPath!);
    return {
      ...verified,
      platform,
      stage: handoff.ok ? 'activation_pending' : 'failed',
      action: 'user_elevation_required',
      activated: false,
      message: handoff.ok
        ? `Windows installer launched for ${update.version}. Accept the elevation prompt to complete it.`
        : `Windows could not launch the installer: ${handoff.detail}`,
      details: { ...verified.details, handoff: handoff.detail },
    };
  }

  return {
    ...verified,
    platform,
    stage: 'failed',
    action: 'unsupported',
    activated: false,
    message: `No activation mechanism exists for platform "${platform}".`,
    details: { ...verified.details, reason: 'unsupported_platform' },
  };
}

/**
 * Confirm the running system really is on `targetVersion`.
 *
 * This is what turns `activation_pending` into `activated`, and it must be
 * driven by the process's own reported state — not by a timer, not by an
 * optimistic assumption after a reload was requested.
 */
export function confirmActivation(
  previous: ActivationResult,
  targetVersion: string,
  running: RunningState,
): ActivationResult {
  const matches = running.version === targetVersion;
  if (matches) {
    return {
      ...previous,
      stage: 'activated',
      action: 'none',
      activated: true,
      message: `Running ${running.version}; the update is active.`,
      details: { ...previous.details, runningVersion: running.version },
    };
  }
  return {
    ...previous,
    stage: 'activation_pending',
    activated: false,
    message: `Still running ${running.version}; ${targetVersion} is not active yet.`,
    details: { ...previous.details, runningVersion: running.version, targetVersion },
  };
}
