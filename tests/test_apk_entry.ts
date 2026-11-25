/**
 * APK download entry — access control and single-entry contract.
 *
 * The APK download is a developer-space-only capability. These tests assert the
 * real HTTP behaviour of the running server (not a mock): an unauthenticated
 * caller must be refused, and the refusal must be an authorization failure
 * rather than a "not found" that would hide a misconfiguration.
 *
 * They also assert the source-level contract that exactly one APK download
 * entry exists in the client, so a future edit cannot silently reintroduce a
 * second one.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Read lazily: the runner sets RARE_TEST_BASE_URL after booting the server on a
// free port, so capturing it at import time would always fall back to :3000.
const baseUrl = () => process.env.RARE_TEST_BASE_URL || 'http://127.0.0.1:3000';

export async function runApkEntryTests(): Promise<void> {
  console.log('\n[apk-entry]');

  // 1. Unauthenticated access to every APK endpoint must be refused.
  for (const endpoint of ['/api/download/apk', '/api/download/apk/info', '/api/download/apk/chunk']) {
    const res = await fetch(`${baseUrl()}${endpoint}`, { redirect: 'manual' });
    assert.ok(
      res.status === 401 || res.status === 403,
      `${endpoint} must refuse an unauthenticated caller (got ${res.status})`
    );
    console.log(`  ✓ ${endpoint} refuses an unauthenticated caller (${res.status})`);
  }

  // 2. The refusal must be an authorization failure, not a missing artifact.
  const apkRes = await fetch(`${baseUrl()}/api/download/apk`, { redirect: 'manual' });
  assert.notEqual(apkRes.status, 404, 'an unauthenticated request must not be answered as "no release published"');
  const body = await apkRes.text();
  assert.ok(
    /authorization|session/i.test(body),
    `the refusal must name the authorization requirement (got: ${body.slice(0, 120)})`
  );
  console.log('  ✓ the refusal names the authorization requirement, not a missing artifact');

  // 3. The APK endpoints must not be listed as public API paths.
  const serverSource = readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
  const publicBlock = /const PUBLIC_API_PATHS = new Set\(\[([\s\S]*?)\]\)/.exec(serverSource);
  assert.ok(publicBlock, 'PUBLIC_API_PATHS must exist');
  assert.ok(
    !publicBlock![1].includes('/api/download/apk'),
    'the APK download endpoints must not be public API paths'
  );
  console.log('  ✓ the APK endpoints are not public API paths');

  // 4. Exactly one APK download entry in the client, and it lives in the
  //    developer space beside the self-development entry.
  const appSource = readFileSync(path.join(process.cwd(), 'src', 'App.tsx'), 'utf8');
  const apkHrefs = appSource.match(/href="\/api\/download\/apk"/g) || [];
  assert.equal(apkHrefs.length, 1, `exactly one APK download link must exist (found ${apkHrefs.length})`);
  console.log('  ✓ exactly one APK download link exists in the client');

  const selfDevIndex = appSource.indexOf("id: 'self_dev'");
  const apkLinkIndex = appSource.indexOf('href="/api/download/apk"');
  assert.ok(selfDevIndex > 0 && apkLinkIndex > selfDevIndex, 'the APK link must sit after the self-development entry');
  assert.ok(
    apkLinkIndex - selfDevIndex < 2000,
    'the APK link must sit beside the self-development entry, not elsewhere in the file'
  );
  console.log('  ✓ the APK link sits beside the self-development entry');

  // 5. The old modal-based entries must be gone.
  assert.ok(
    !appSource.includes('DownloadAppModal'),
    'the DownloadAppModal entry points must be removed from the client'
  );
  assert.ok(
    !appSource.includes('onOpenDownloadModal'),
    'the download-modal prop plumbing must be removed'
  );
  console.log('  ✓ the previous modal-based APK entries are removed');
}
