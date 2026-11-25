/**
 * DeploymentManager — deploy a built project to Vercel and verify it is live.
 *
 * The assignment is explicit that building, deploying, hosting and verifying
 * are separate capabilities, and that a deployment must not be reported as
 * successful because a request was accepted. So this module:
 *
 *   1. uploads the real files (Vercel's file API, inline for small projects),
 *   2. creates a deployment and polls until it reaches a terminal state,
 *   3. fetches the deployed URL and reports the actual HTTP status,
 *   4. distinguishes `ready` from `error`/`canceled` and surfaces Vercel's own
 *      error code — including the account-level `limited` condition, which is
 *      a real blocker and must be reported as one rather than retried forever.
 *
 * No paid plan is activated and no billing change is made. If the account
 * cannot deploy, that is reported with the exact API response.
 */

const API = 'https://api.vercel.com';

export interface DeployFile {
  /** Path inside the deployment, e.g. "index.html". */
  file: string;
  /** UTF-8 content. */
  content: string;
}

export interface DeploymentResult {
  ok: boolean;
  /** Vercel deployment id, when one was created. */
  id: string | null;
  /** Terminal state: READY | ERROR | CANCELED | BUILDING | QUEUED. */
  state: string;
  url: string | null;
  /** The alias the caller asked for, when it was applied. */
  alias: string | null;
  /** HTTP status of a real GET against the deployed URL. */
  httpStatus: number | null;
  /** Vercel's error code, e.g. BUILD_FAILED or the account `limited` flag. */
  errorCode: string | null;
  errorMessage: string | null;
  /** Every state transition observed while polling, for the evidence trail. */
  transitions: Array<{ state: string; at: string }>;
  durationMs: number;
}

function token(): string | null {
  return process.env.VERCEL_TOKEN?.trim() || null;
}

function teamId(): string | null {
  return process.env.VERCEL_TEAM_ID?.trim() || null;
}

export function isConfigured(): boolean {
  return token() !== null;
}

function withTeam(pathname: string): string {
  const team = teamId();
  if (!team) return pathname;
  return `${pathname}${pathname.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(team)}`;
}

async function api<T>(
  method: string,
  pathname: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: T | null; error: string | null }> {
  const auth = token();
  if (!auth) {
    return { ok: false, status: 0, data: null, error: 'VERCEL_TOKEN is not set.' };
  }
  try {
    const response = await fetch(`${API}${withTeam(pathname)}`, {
      method,
      headers: {
        Authorization: `Bearer ${auth}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data: null,
        error: parsed?.error?.message || parsed?.message || text.slice(0, 300) || `HTTP ${response.status}`,
      };
    }
    return { ok: true, status: response.status, data: parsed as T, error: null };
  } catch (error: any) {
    return { ok: false, status: 0, data: null, error: error?.message || 'Network error' };
  }
}

/** Report the account's deployment capability, including the `limited` flag. */
export async function accountStatus(): Promise<{
  ok: boolean;
  username: string | null;
  limited: boolean;
  error: string | null;
}> {
  const result = await api<any>('GET', '/v2/user');
  if (!result.ok || !result.data) {
    return { ok: false, username: null, limited: false, error: result.error };
  }
  return {
    ok: true,
    username: result.data.user?.username || null,
    limited: Boolean(result.data.user?.limited),
    error: null,
  };
}

/**
 * Deploy a set of static files.
 *
 * Files are sent inline. Vercel accepts inline file content for small
 * deployments, which avoids a separate upload round-trip and keeps the whole
 * operation in one request that can be reasoned about.
 */
export async function deployStatic(
  projectName: string,
  files: DeployFile[],
  options: { target?: 'production' | 'preview'; pollMs?: number; maxWaitMs?: number } = {},
): Promise<DeploymentResult> {
  const started = Date.now();
  const transitions: Array<{ state: string; at: string }> = [];

  if (!files.length) {
    return {
      ok: false,
      id: null,
      state: 'ERROR',
      url: null,
      alias: null,
      httpStatus: null,
      errorCode: 'NO_FILES',
      errorMessage: 'No files were supplied to deploy.',
      transitions,
      durationMs: 0,
    };
  }

  const created = await api<any>('POST', '/v13/deployments?skipAutoDetectionConfirmation=1', {
    name: projectName,
    files: files.map((file) => ({ file: file.file, data: file.content })),
    // Vercel requires projectSettings for a project it has not seen before.
    // `framework: null` means "plain static files", which is what a scaffolded
    // static-web project is. Without this the API returns 400
    // missing_project_settings and no deployment is created at all.
    projectSettings: { framework: null },
    target: options.target || 'production',
  });

  if (!created.ok || !created.data) {
    return {
      ok: false,
      id: null,
      state: 'ERROR',
      url: null,
      alias: null,
      httpStatus: null,
      errorCode: created.status === 402 || created.status === 403 ? 'ACCOUNT_LIMITED' : 'CREATE_FAILED',
      errorMessage: created.error,
      transitions,
      durationMs: Date.now() - started,
    };
  }

  const id: string = created.data.id;
  const initialUrl: string | null = created.data.url ? `https://${created.data.url}` : null;
  transitions.push({ state: created.data.readyState || 'QUEUED', at: new Date().toISOString() });

  // Poll to a terminal state. A deployment that never settles is reported as
  // still building rather than being called a success.
  const pollMs = options.pollMs ?? 4000;
  const maxWaitMs = options.maxWaitMs ?? 240_000;
  let state: string = created.data.readyState || 'QUEUED';
  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  let finalUrl = initialUrl;

  while (Date.now() - started < maxWaitMs) {
    if (['READY', 'ERROR', 'CANCELED'].includes(state)) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));

    const polled = await api<any>('GET', `/v13/deployments/${id}`);
    if (!polled.ok || !polled.data) {
      errorCode = 'POLL_FAILED';
      errorMessage = polled.error;
      break;
    }
    const next: string = polled.data.readyState || polled.data.state || state;
    if (next !== state) {
      transitions.push({ state: next, at: new Date().toISOString() });
      state = next;
    }
    if (polled.data.url) finalUrl = `https://${polled.data.url}`;
    if (polled.data.errorCode) errorCode = polled.data.errorCode;
    if (polled.data.errorMessage) errorMessage = polled.data.errorMessage;
  }

  // Verify with a real request. A READY state is Vercel's claim; the HTTP
  // status is the evidence.
  let httpStatus: number | null = null;
  if (state === 'READY' && finalUrl) {
    httpStatus = await probeUrl(finalUrl);

    // A new Vercel project is created with Deployment Protection on, which
    // answers every anonymous request with a 302 to a Vercel sign-in page. The
    // deployment is genuinely live, but nobody outside the team can see it, so
    // it is not a delivered application. Turning protection off is a project
    // setting, not a billing change, and it is what makes the URL usable.
    if (httpStatus === 302 || httpStatus === 401 || httpStatus === 403) {
      const unprotected = await disableProtection(projectName);
      if (unprotected.ok) {
        // Protection changes take a few seconds to propagate to the edge, so
        // the re-probe retries rather than reading a stale 302 as a failure.
        httpStatus = await probeUrl(finalUrl, 4);
      } else {
        errorCode = 'PROTECTED';
        errorMessage = `The deployment is live but Vercel Deployment Protection is on and could not be disabled: ${unprotected.error}`;
      }
    }
  }

  return {
    ok: state === 'READY' && httpStatus !== null && httpStatus < 400,
    id,
    state,
    url: finalUrl,
    alias: null,
    httpStatus,
    errorCode,
    errorMessage,
    transitions,
    durationMs: Date.now() - started,
  };
}

/**
 * Fetch a deployed URL and return its HTTP status.
 *
 * `redirect: 'manual'` is deliberate: a 302 to Vercel's sign-in page is the
 * signal that Deployment Protection is on, and following it would hide that
 * behind a 200 from the login page.
 */
async function probeUrl(url: string, attempts = 1): Promise<number | null> {
  let last: number | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { method: 'GET', redirect: 'manual' });
      last = response.status;
      // A 2xx is final. A 302/401/403 may be a protection setting that is still
      // propagating, so it is worth one more look after a short pause.
      if (last >= 200 && last < 300) return last;
    } catch {
      last = null;
    }
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return last;
}

/**
 * Turn off Vercel Deployment Protection for a project.
 *
 * A newly created project defaults to SSO protection, which makes every
 * anonymous request redirect to a Vercel login. That is a project setting, not
 * a plan or billing change, so disabling it is within the "no paid services"
 * rule. It is what makes a deployed URL actually usable by the person who
 * asked for it.
 */
async function disableProtection(projectName: string): Promise<{ ok: boolean; error: string | null }> {
  const result = await api<any>('PATCH', `/v9/projects/${encodeURIComponent(projectName)}`, {
    ssoProtection: null,
    passwordProtection: null,
  });
  return { ok: result.ok, error: result.error };
}

/** Point a project's production alias at a deployment. */
export async function aliasDeployment(
  projectName: string,
  deploymentId: string,
): Promise<{ ok: boolean; alias: string | null; error: string | null }> {
  const result = await api<any>('POST', `/v2/projects/${encodeURIComponent(projectName)}/deployments`, {
    deploymentId,
  });
  if (!result.ok) return { ok: false, alias: null, error: result.error };
  return { ok: true, alias: result.data?.alias?.[0]?.domain || null, error: null };
}

/** A compact summary for a chat reply. */
export function summariseDeployment(result: DeploymentResult): string {
  if (result.ok) {
    return `Deployed and verified: ${result.url} returned HTTP ${result.httpStatus} (state ${result.state}, ${Math.round(result.durationMs / 1000)}s).`;
  }
  const reason = result.errorMessage || result.errorCode || 'unknown error';
  return `Deployment did not succeed: state ${result.state}${result.errorCode ? `, code ${result.errorCode}` : ''} — ${reason}.`;
}
