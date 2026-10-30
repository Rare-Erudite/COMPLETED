/**
 * RARE — Startup readiness contract
 *
 * `server.ts` exported `apiStartupFailed` as
 * `startupFailure !== undefined`, evaluated once at module load. For the whole
 * window before `ready` settled, that read `false` — so a caller asking "did
 * startup succeed?" during (or after) a hard failure was told yes. Worse, on
 * Vercel a boot failure still let the SPA boot, so the deployment *looked* fine
 * while every database-backed route silently had no durable state.
 *
 * This group pins the corrected contract:
 *
 *   apiReadiness()          awaits the same promise the /api gate awaits, then
 *                           reports `failed` with the real cause — no window in
 *                           which a failure reads as success.
 *   storageReady            is false whenever boot did not complete, so a
 *                           request cannot pretend to have durable state.
 *   getApiStartupFailed()   re-reads live state instead of a frozen boolean.
 *
 * Both a *successful* boot and an *unavailable storage* boot are exercised. The
 * failure case is produced by removing the origins the server requires in
 * production, which is a real misconfiguration rather than a stubbed throw.
 */

import assert from 'assert';

let pass = 0;
let fail = 0;

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    pass += 1;
    console.log(`  PASS  ${name}`);
  } catch (error: any) {
    fail += 1;
    console.error(`  FAIL  ${name} — ${error?.message || error}`);
  }
}

function snapshotEnv(keys: string[]): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const key of keys) saved[key] = process.env[key];
  return saved;
}

function restoreEnv(saved: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete (process.env as Record<string, string | undefined>)[key];
    else (process.env as Record<string, string>)[key] = value;
  }
}

const ENV_KEYS = ['VERCEL', 'NODE_ENV', 'RARE_ALLOWED_ORIGINS', 'DATABASE_URL', 'RARE_ALLOW_LOCAL_STORAGE_FALLBACK'];

export async function runStartupReadinessTests() {
  console.log('[Test Group] Startup readiness contract (truthful status, fail-closed storage)');
  const saved = snapshotEnv(ENV_KEYS);

  try {
    // ---- Failure path ------------------------------------------------------
    // Production on Vercel with no allowed origins is a genuine startup failure:
    // the server refuses to run in production without an explicit origin.
    process.env.VERCEL = '1';
    process.env.NODE_ENV = 'production';
    delete process.env.RARE_ALLOWED_ORIGINS;

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    const mod: any = await import(`../server.ts?readiness=${Date.now()}`);

    await check('apiReadiness is exported as the authoritative accessor', () => {
      assert.strictEqual(typeof mod.apiReadiness, 'function', 'apiReadiness must be exported');
      assert.strictEqual(typeof mod.getApiStartupFailed, 'function', 'getApiStartupFailed must be exported');
    });

    const readiness = await mod.apiReadiness();

    await check('a failed boot reports state "failed" with the real cause', () => {
      assert.strictEqual(readiness.state, 'failed', `state was "${readiness.state}"`);
      assert.strictEqual(readiness.ready, false);
      assert.ok(readiness.error && readiness.error.length > 0, 'the failure must carry a message');
      assert.ok(
        /RARE_ALLOWED_ORIGINS/i.test(readiness.error),
        `the cause must be specific, got: ${readiness.error}`,
      );
    });

    await check('a failed boot does not claim durable storage is ready', () => {
      assert.strictEqual(
        readiness.storageReady,
        false,
        'a request must not be told storage is ready when boot failed',
      );
    });

    await check('the sync accessor reflects the live failure, not a frozen module-load value', () => {
      // This is the exact bug: the old constant was computed at import time,
      // before the rejection had been recorded, and stayed `false` forever.
      assert.strictEqual(mod.getApiStartupFailed(), true);
    });

    await check('the /api gate fails closed with 503 and names the cause', async () => {
      const http = await import('node:http');
      const server = http.createServer(mod.default);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      try {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        assert.strictEqual(response.status, 503, `expected 503, got ${response.status}`);
        const body = await response.json();
        const detail = JSON.stringify(body);
        assert.ok(/RARE_ALLOWED_ORIGINS/i.test(detail), `the 503 must name the real cause: ${detail}`);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    await check('the failed boot is handled, not left as an unhandled rejection', () => {
      assert.strictEqual(unhandled.length, 0, `saw ${unhandled.length} unhandled rejection(s)`);
    });

    process.off('unhandledRejection', onUnhandled);

    // ---- Success path ------------------------------------------------------
    // A correctly configured instance must report ready AND storageReady, so the
    // contract is not merely "always pessimistic".
    restoreEnv(saved);
    process.env.NODE_ENV = 'test';
    process.env.RARE_ALLOW_LOCAL_STORAGE_FALLBACK = 'true';
    delete process.env.VERCEL;
    const origin = `http://127.0.0.1:${65000 + Math.floor(Math.random() * 400)}`;
    process.env.RARE_ALLOWED_ORIGINS = origin;

    const okMod: any = await import(`../server.ts?readiness-ok=${Date.now()}`);
    const okReadiness = await okMod.apiReadiness();

    await check('a successful boot reports ready with storage available', () => {
      assert.strictEqual(okReadiness.state, 'ready', `state was "${okReadiness.state}": ${okReadiness.error}`);
      assert.strictEqual(okReadiness.ready, true);
      assert.strictEqual(okReadiness.storageReady, true, 'a successful boot must report storage as ready');
      assert.strictEqual(okReadiness.error, undefined);
    });

    await check('a successful boot reports no failure through the sync accessor', () => {
      assert.strictEqual(okMod.getApiStartupFailed(), false);
    });
  } finally {
    restoreEnv(saved);
  }

  console.log(`  → ${pass} passed, ${fail} failed\n`);
  if (fail > 0) throw new Error(`${fail} startup readiness assertion(s) failed.`);
}
