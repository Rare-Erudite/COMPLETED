/**
 * RARE — Where does this operation actually run?
 *
 * Provisioning code that probes `process.platform` is answering a question about
 * *the machine the code is running on* — and for RARE that is usually **not** the
 * user's machine. The hosted Express backend runs in Vercel's serverless
 * environment: a short-lived Linux container with no relationship to the user's
 * Windows laptop or Android phone.
 *
 * That distinction is the difference between an honest product and a lying one:
 *
 *   - Detecting `node` in the Vercel container says nothing about the user's
 *     laptop, and definitely does not mean RARE can build an APK there.
 *   - A browser cannot read `PATH`, install software, enumerate device files or
 *     control the OS. Claiming otherwise is the failure mode this module exists
 *     to prevent.
 *
 * So every capability is labelled with *where* it can run and, where it cannot,
 * what the real obstacle is. Nothing here pretends a remote browser has local
 * privileges.
 *
 * This is deliberately a data + query module rather than prose: the UI and the
 * Assistant both need to ask "can this run here?" and get a truthful answer they
 * can render.
 */

export type ExecutionSite =
  /** Vercel/serverless container. Ephemeral Linux, no user data, no user PATH. */
  | 'serverless'
  /** The user's own machine, reached through a real installed app. */
  | 'local-native'
  /** The sandboxed browser tab. No filesystem, no PATH, no OS control. */
  | 'browser'
  /** Not possible on this platform, for the stated reason. */
  | 'unavailable';

export interface CapabilityPlacement {
  capability: string;
  /** Human label. */
  label: string;
  /** Where it genuinely executes. */
  site: ExecutionSite;
  /** True when the site's filesystem survives between requests. */
  durableFilesystem: boolean;
  /** What RARE can honestly do there. */
  canDo: string;
  /** What it cannot, and why. Empty when there is no limitation. */
  limitation?: string;
}

/**
 * The canonical placement table. Anything not listed is `unavailable` by
 * default rather than optimistically assumed to work.
 */
export const CAPABILITY_PLACEMENTS: CapabilityPlacement[] = [
  {
    capability: 'project_source_inspection',
    label: 'Read and analyse project source',
    site: 'serverless',
    durableFilesystem: false,
    canDo: 'Parse manifests, lockfiles, source files and dependency trees.',
  },
  {
    capability: 'provision_runtime',
    label: 'Provision a runtime (Node, CPython, Dart)',
    site: 'serverless',
    durableFilesystem: false,
    canDo: 'Download, checksum-verify and unpack a portable runtime, then execute it for the duration of the container.',
    limitation:
      'The container is ephemeral, so a provisioned runtime does not survive a cold start. It is re-provisioned cheaply from the cache when one is mounted, otherwise re-downloaded. For a durable per-user toolchain, the local agent is the supported path.',
  },
  {
    capability: 'run_project_tests',
    label: 'Run a project test suite',
    site: 'serverless',
    durableFilesystem: false,
    canDo: 'Execute the project declared test command against the provisioned runtime.',
    limitation: 'Bounded by the function timeout; long suites must be chunked or run locally.',
  },
  {
    capability: 'build_native_artifact',
    label: 'Produce a native artifact (APK, EXE, installer)',
    site: 'local-native',
    durableFilesystem: true,
    canDo: 'With the RARE desktop/mobile app and its local execution agent, run a real toolchain on the user machine.',
    limitation:
      'Not possible in the hosted backend: it has no Android SDK, no Windows toolchain, and no licence acceptance. RARE will report this rather than pretend a build occurred.',
  },
  {
    capability: 'inspect_device_path',
    label: 'Inspect the device PATH and installed tools',
    site: 'local-native',
    durableFilesystem: true,
    canDo: 'The packaged app can read the local environment.',
    limitation:
      'A web page cannot. The browser has no filesystem or environment access, so RARE never claims to have probed the user machine from the page.',
  },
  {
    capability: 'read_device_files',
    label: 'Read files the user selects',
    site: 'browser',
    durableFilesystem: false,
    canDo: 'Read files the user explicitly picks, in the page, and send their contents to the backend for processing.',
    limitation: 'Only user-initiated selection. No silent enumeration of the device.',
  },
  {
    capability: 'control_os',
    label: 'Control the operating system',
    site: 'unavailable',
    durableFilesystem: false,
    canDo: 'Nothing from a browser tab.',
    limitation:
      'Requires an authorized native integration with explicit OS permissions. A web page cannot install software, elevate privileges or control the OS, and RARE will not claim it can.',
  },
  {
    capability: 'background_wake_word',
    label: 'Background wake-word listening',
    site: 'unavailable',
    durableFilesystem: false,
    canDo: 'Listen while the page is open and foregrounded.',
    limitation:
      'Browsers suspend microphone capture and timers when a tab is backgrounded, so a web page cannot listen in the background. This needs a native app with a foreground service.',
  },
  {
    capability: 'deploy_web_release',
    label: 'Deploy a web release',
    site: 'serverless',
    durableFilesystem: false,
    canDo: 'Trigger and verify a deployment through an authorized connector.',
    limitation: 'A connector existence is not permission to deploy; production promotion stays an explicit, authorized action.',
  },
];

/** The placement for a capability, or a fail-closed `unavailable` record. */
export function placementFor(capability: string): CapabilityPlacement {
  return (
    CAPABILITY_PLACEMENTS.find((entry) => entry.capability === capability) || {
      capability,
      label: capability,
      site: 'unavailable',
      durableFilesystem: false,
      canDo: 'Nothing known.',
      limitation: 'This capability has no documented execution site, so RARE treats it as unavailable.',
    }
  );
}

/**
 * Which site RARE itself is currently executing on.
 *
 * This is about *the process*, not the user — callers must not present it as a
 * statement about the user's device. `isServerless()` being true is exactly why
 * a local capability cannot be satisfied here.
 */
export function currentExecutionSite(): ExecutionSite {
  if (process.env.VERCEL === '1') return 'serverless';
  return 'local-native';
}

export function isServerless(): boolean {
  return currentExecutionSite() === 'serverless';
}

/**
 * Can `capability` be executed by the process that is asking?
 *
 * A capability whose real site is `local-native` is **not** executable from the
 * hosted backend, no matter how the request is phrased. Returning `true` here
 * would be the exact false-confidence bug this module exists to prevent.
 */
export function canExecuteHere(capability: string): { ok: boolean; reason: string } {
  const placement = placementFor(capability);
  const here = currentExecutionSite();

  if (placement.site === 'unavailable') {
    return { ok: false, reason: placement.limitation || 'This capability is not available.' };
  }
  if (placement.site === 'local-native' && here !== 'local-native') {
    return {
      ok: false,
      reason: `${placement.label} must run on the user device, and this process is running on the ${here} host. ${
        placement.limitation || ''
      }`.trim(),
    };
  }
  if (placement.site === 'browser') {
    return { ok: false, reason: `${placement.label} happens in the browser, not on the server.` };
  }
  return { ok: true, reason: placement.canDo };
}

/**
 * The one-line statement of platform reality that any capability report should
 * carry when it runs on the hosted backend, so the user is never left thinking a
 * serverless probe described their own machine.
 */
export function platformCaveat(): string {
  if (!isServerless()) return '';
  return 'This runs on the hosted RARE backend, not on your device. Tools detected here are not tools on your computer.';
}
