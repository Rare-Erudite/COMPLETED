import http from 'node:http';

/**
 * Regression test for the "Cannot GET /" deployment failure.
 *
 * The Vercel build invokes `server.ts` as a serverless function. When API
 * initialisation throws (missing RARE_ALLOWED_ORIGINS, unreachable
 * DATABASE_URL, uninstalled schema), the process must still serve the SPA.
 * Before the fix, the static layer was registered only at the *end* of
 * startServer(), so a boot failure left the app with no routes at all and
 * Express answered every URL with a bare "Cannot GET /".
 */

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

export async function runServerlessFrontendAvailabilityTests() {
  console.log('[Test Group] Vercel serverless: frontend availability when API init fails');

  const saved = {
    VERCEL: process.env.VERCEL,
    NODE_ENV: process.env.NODE_ENV,
    RARE_ALLOWED_ORIGINS: process.env.RARE_ALLOWED_ORIGINS,
    DATABASE_URL: process.env.DATABASE_URL,
  };

  // Simulate the worst case: production on Vercel with the API unable to boot.
  process.env.VERCEL = '1';
  process.env.NODE_ENV = 'production';
  delete process.env.RARE_ALLOWED_ORIGINS;

  // A boot failure must be *handled*, not left as an unhandled rejection: an
  // unhandled rejection at module scope kills the Node process, which would
  // take the SPA down with the API and reintroduce "Cannot GET /".
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  let server: http.Server | undefined;
  try {
    // Fresh module instance, exactly as a cold start would load it.
    const mod = await import(`../server.ts?case=${Date.now()}`);
    const app = (mod as { default?: unknown }).default;
    check('server module default-exports an Express app', typeof app === 'function');
    if (typeof app !== 'function') return;

    // Let module-level startServer() settle into its failure state.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    server = http.createServer(app as http.RequestListener);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    for (const route of ['/', '/index.html', '/a/deep/spa/route']) {
      const res = await fetch(`http://127.0.0.1:${port}${route}`);
      const body = await res.text();
      check(
        `${route} serves the SPA shell even with a failed API boot`,
        res.status === 200 &&
          (res.headers.get('content-type') || '').includes('text/html') &&
          body.includes('id="root"'),
        `got ${res.status} ${res.headers.get('content-type')} (${body.length}b)`,
      );
      check(
        `${route} never returns the bare Express "Cannot GET" page`,
        !body.includes('Cannot GET /'),
      );
    }

    // The API must still fail closed rather than pretending to be healthy.
    const api = await fetch(`http://127.0.0.1:${port}/api/health`);
    check(
      '/api/health fails closed with 503 when init failed',
      api.status === 503,
      `got ${api.status}`,
    );
  } finally {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    process.off('unhandledRejection', onUnhandled);

    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete (process.env as Record<string, string | undefined>)[key];
      else (process.env as Record<string, string>)[key] = value as string;
    }
  }

  check(
    'boot failure is handled, not left as an unhandled rejection',
    unhandled.length === 0,
    `saw ${unhandled.length} unhandled rejection(s)`,
  );

  console.log(`  → ${pass} passed, ${fail} failed\n`);
  if (fail > 0) {
    throw new Error(`${fail} serverless frontend availability assertion(s) failed.`);
  }
}
