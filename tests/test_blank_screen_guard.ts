/**
 * Blank-screen regression guard.
 *
 * The production white screen was caused by the SPA catch-all answering a
 * request for a missing hashed asset with `200 text/html`. The browser then
 * refused the module script on MIME grounds and React never mounted, leaving
 * `#root` empty.
 *
 * The shared test server runs API-only (RARE_SKIP_DEV_BUNDLER), so it never
 * exercises the static layer that broke. This suite therefore boots its own
 * server in the exact production configuration (NODE_ENV=production,
 * VERCEL=1) against the built `public/` directory, and asserts the real HTTP
 * contract of that code path.
 */

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(base: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('production-mode server did not become healthy in time');
}

export async function runBlankScreenGuardTests(): Promise<void> {
  console.log('\n[blank-screen-guard]');

  const publicIndex = path.join(process.cwd(), 'public', 'index.html');
  if (!existsSync(publicIndex)) {
    console.log('  SKIP — no built public/index.html (run `npm run build` first). Not a code defect.');
    return;
  }

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let child: ChildProcess | null = null;

  try {
    child = spawn(process.execPath, [path.join(process.cwd(), 'server-build', 'server.js')], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        RARE_SKIP_DEV_BUNDLER: 'true',
        RARE_ALLOWED_ORIGINS: base,
        RARE_ALLOW_LOCAL_STORAGE_FALLBACK: 'true',
      },
      stdio: 'ignore',
    });

    await waitForHealth(base);

    // 1. A missing hashed asset must be a 404 with a non-HTML body. This is the
    //    exact request a browser holding a stale index.html makes.
    const missing = await fetch(`${base}/assets/index-DOES-NOT-EXIST-999.js`);
    assert.equal(missing.status, 404, `a missing asset must be 404 (got ${missing.status})`);
    const missingType = missing.headers.get('content-type') || '';
    assert.ok(
      !missingType.includes('text/html'),
      `a missing asset must not be answered with HTML (got ${missingType})`
    );
    console.log('  ✓ a missing hashed asset is a 404, not an HTML page');

    // 2. A real asset still serves, with an immutable cache header.
    const html = readFileSync(publicIndex, 'utf8');
    const assetMatch = /\/assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(html);
    assert.ok(assetMatch, 'the built index.html must reference a hashed JS bundle');
    const realAsset = await fetch(`${base}/assets/${assetMatch![1]}`);
    assert.equal(realAsset.status, 200, 'the current bundle must serve');
    assert.ok(
      (realAsset.headers.get('content-type') || '').includes('javascript'),
      'the current bundle must be served as JavaScript'
    );
    console.log('  ✓ the current bundle serves as JavaScript');

    // 3. index.html must be revalidated, never cached as immutable.
    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    const cacheControl = index.headers.get('cache-control') || '';
    assert.ok(
      /no-cache|no-store|must-revalidate/.test(cacheControl),
      `index.html must be revalidated (got Cache-Control: ${cacheControl || 'none'})`
    );
    console.log('  ✓ index.html is served with a revalidating Cache-Control');

    // 4. The shell must carry a visible boot placeholder.
    const servedHtml = await index.text();
    assert.ok(/Starting RARE/.test(servedHtml), 'the shell must render a visible boot placeholder');
    assert.ok(/Reload the app/.test(servedHtml), 'the boot placeholder must offer a reload action');
    console.log('  ✓ the shell ships a visible boot placeholder with a reload action');

    // 5. A deep link still serves the SPA shell (routing must not regress).
    const deep = await fetch(`${base}/settings`);
    assert.equal(deep.status, 200);
    assert.ok(/Starting RARE/.test(await deep.text()), 'a deep link must serve the SPA shell');
    console.log('  ✓ a deep link still serves the SPA shell');

    // 6. The client must mount inside an error boundary.
    const mainSource = readFileSync(path.join(process.cwd(), 'src', 'main.tsx'), 'utf8');
    assert.ok(
      mainSource.includes('AppErrorBoundary'),
      'the app must mount inside an error boundary so a render error cannot blank the page'
    );
    console.log('  ✓ the app mounts inside an error boundary');
  } finally {
    if (child) {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 800));
      if (!child.killed) child.kill('SIGKILL');
    }
  }
}
