/**
 * Proves the update pipeline distinguishes download / verify / activate and
 * never reports an installation that did not happen.
 *
 * The old code path downloaded a file, verified its checksum, called an
 * `onApplyUpdate` nothing listened to, and had a 501 endpoint behind it. These
 * assertions are about the honest states, including the refusals.
 */

import assert from 'assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  activate,
  confirmActivation,
  downloadAndVerify,
  sha256,
} from '../src/server/updates/UpdateActivation.js';
import { UpdateStore, type AppUpdate } from '../src/server/storage/UpdateStore.js';

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

function makeUpdate(overrides: Partial<AppUpdate> = {}): AppUpdate {
  return {
    id: 'upd_test',
    version: '2.0.0',
    releaseDate: new Date().toISOString(),
    channel: 'public',
    title: 'Test release',
    description: 'Test',
    changelog: ['change'],
    platform: 'web',
    packageUrl: 'https://github.com/Rare-Erudite/COMPLETED/releases/download/v2.0.0/app.bin',
    artifactSizeBytes: 4,
    sha256: sha256(Buffer.from('RARE')),
    publishedBy: 'test',
    targetRoles: ['all'],
    ...overrides,
  };
}

export async function runUpdateTests() {
  console.log('[Test Group] Update download, verification and activation semantics');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-updates-'));
  const body = Buffer.from('RARE');

  await check('a matching artifact verifies and is written', async () => {
    const update = makeUpdate();
    const result = await downloadAndVerify(update, {
      downloadDir: dir,
      fetchBytes: async () => body,
    });
    assert.strictEqual(result.stage, 'verified', `${result.stage}: ${result.message}`);
    assert.strictEqual(result.checksumVerified, true);
    assert.ok(result.artifactPath && fs.existsSync(result.artifactPath), 'artifact must be on disk');
    assert.strictEqual(fs.readFileSync(result.artifactPath!).equals(body), true);
  });

  await check('a checksum mismatch is rejected before anything is written', async () => {
    const update = makeUpdate({ artifactSizeBytes: body.length, sha256: sha256(Buffer.from('FAKE')) });
    const before = fs.readdirSync(dir).length;
    const result = await downloadAndVerify(update, {
      downloadDir: dir,
      fetchBytes: async () => body,
    });
    assert.strictEqual(result.stage, 'failed');
    assert.strictEqual(result.checksumVerified, false);
    assert.ok(/checksum mismatch/i.test(result.message), result.message);
    assert.strictEqual(fs.readdirSync(dir).length, before, 'no file may be written');
  });

  await check('a size mismatch is rejected with the real numbers', async () => {
    const update = makeUpdate({ artifactSizeBytes: 999 });
    const result = await downloadAndVerify(update, {
      downloadDir: dir,
      fetchBytes: async () => body,
    });
    assert.strictEqual(result.stage, 'failed');
    assert.strictEqual(result.details.reason, 'size_mismatch');
    assert.ok(String(result.message).includes('999'), result.message);
  });

  await check('a release with no checksum cannot be trusted', async () => {
    const update = makeUpdate({ sha256: '' as any });
    const result = await downloadAndVerify(update, {
      downloadDir: dir,
      fetchBytes: async () => body,
    });
    assert.strictEqual(result.stage, 'failed');
    assert.strictEqual(result.details.reason, 'missing_checksum');
  });

  await check('an oversized artifact is refused', async () => {
    const update = makeUpdate({ artifactSizeBytes: body.length });
    const result = await downloadAndVerify(update, {
      downloadDir: dir,
      fetchBytes: async () => body,
      maxBytes: 2,
    });
    assert.strictEqual(result.stage, 'failed');
    assert.strictEqual(result.details.reason, 'too_large');
  });

  await check('a download failure is reported as failed, not pending', async () => {
    const update = makeUpdate();
    const result = await downloadAndVerify(update, {
      downloadDir: dir,
      fetchBytes: async () => {
        throw new Error('ECONNRESET');
      },
    });
    assert.strictEqual(result.stage, 'failed');
    assert.ok(/ECONNRESET/.test(result.message), result.message);
  });

  // --- activation semantics ------------------------------------------------

  const verifiedResult = async (platform: 'web' | 'android' | 'windows') => {
    const update = makeUpdate({ platform });
    return downloadAndVerify(update, { downloadDir: dir, fetchBytes: async () => body });
  };

  await check('web: verified artifact is pending a reload, not activated', async () => {
    const update = makeUpdate({ platform: 'web' });
    const verified = await verifiedResult('web');
    const result = await activate(update, verified, { running: { version: '1.0.0' } });
    assert.strictEqual(result.stage, 'activation_pending');
    assert.strictEqual(result.action, 'reload_required');
    assert.strictEqual(result.activated, false, 'a pending reload is not an installation');
    assert.ok(/[Rr]eload/.test(result.message), result.message);
  });

  await check('web: already on the target version reports activated with no action', async () => {
    const update = makeUpdate({ platform: 'web' });
    const verified = await verifiedResult('web');
    const result = await activate(update, verified, { running: { version: '2.0.0' } });
    assert.strictEqual(result.stage, 'activated');
    assert.strictEqual(result.activated, true);
    assert.strictEqual(result.action, 'none');
  });

  await check('android: never claims a silent install', async () => {
    const update = makeUpdate({ platform: 'android' });
    const verified = await verifiedResult('android');
    const result = await activate(update, verified, { running: { version: '1.0.0' } });
    assert.strictEqual(result.activated, false);
    assert.strictEqual(result.action, 'user_install_required');
    assert.strictEqual(result.stage, 'activation_pending');
    assert.ok(/cannot install it silently|will ask you/i.test(result.message), result.message);
  });

  await check('android: a failed handoff is reported as failed', async () => {
    const update = makeUpdate({ platform: 'android' });
    const verified = await verifiedResult('android');
    const result = await activate(update, verified, {
      running: { version: '1.0.0' },
      handOffToOs: async () => ({ ok: false, detail: 'no handler for application/vnd.android.package-archive' }),
    });
    assert.strictEqual(result.stage, 'failed');
    assert.strictEqual(result.activated, false);
    assert.ok(/no handler/.test(result.message), result.message);
  });

  await check('windows: requires elevation and does not claim success', async () => {
    const update = makeUpdate({ platform: 'windows' });
    const verified = await verifiedResult('windows');
    const result = await activate(update, verified, { running: { version: '1.0.0' } });
    assert.strictEqual(result.action, 'user_elevation_required');
    assert.strictEqual(result.activated, false);
    assert.ok(/elevation/i.test(result.message), result.message);
  });

  await check('activation refuses an unverified artifact', async () => {
    const update = makeUpdate({ platform: 'web' });
    const failed = await downloadAndVerify(update, {
      downloadDir: dir,
      fetchBytes: async () => Buffer.from('TAMPERED'),
    });
    const result = await activate(update, failed, { running: { version: '1.0.0' } });
    assert.strictEqual(result.stage, 'failed');
    assert.strictEqual(result.activated, false);
    assert.strictEqual(result.details.reason, 'not_verified');
  });

  await check('confirmActivation only activates on a real version match', async () => {
    const update = makeUpdate({ platform: 'web' });
    const verified = await verifiedResult('web');
    const pending = await activate(update, verified, { running: { version: '1.0.0' } });

    const stillOld = confirmActivation(pending, '2.0.0', { version: '1.0.0' });
    assert.strictEqual(stillOld.activated, false, 'unchanged version must not be called active');
    assert.strictEqual(stillOld.stage, 'activation_pending');

    const nowNew = confirmActivation(pending, '2.0.0', { version: '2.0.0' });
    assert.strictEqual(nowNew.activated, true);
    assert.strictEqual(nowNew.stage, 'activated');
  });

  console.log('  [Test Group] Release channel isolation');
  await check('public listing never contains developer releases', async () => {
    const storePath = path.join(dir, 'updates.json');
    fs.writeFileSync(storePath, '[]');
    const store = new UpdateStore(storePath);

    store.publish({
      version: '3.0.0',
      channel: 'developer',
      title: 'Internal build',
      description: 'dev only',
      changelog: ['wip'],
      packageUrl: 'https://github.com/Rare-Erudite/COMPLETED/releases/download/v3/dev.bin',
      platform: 'web',
      artifactSizeBytes: 4,
      sha256: sha256(Buffer.from('RARE')),
      publishedBy: 'dev',
    });
    store.publish({
      version: '2.5.0',
      channel: 'public',
      title: 'Stable',
      description: 'public',
      changelog: ['ok'],
      packageUrl: 'https://github.com/Rare-Erudite/COMPLETED/releases/download/v2.5/stable.bin',
      platform: 'web',
      artifactSizeBytes: 4,
      sha256: sha256(Buffer.from('RARE')),
      publishedBy: 'dev',
    });

    const publicList = store.getAll('public');
    assert.strictEqual(publicList.length, 1, `public saw ${publicList.length} releases`);
    assert.ok(!publicList.some((u) => u.version === '3.0.0'), 'developer release leaked to public');
    assert.ok(publicList.some((u) => u.version === '2.5.0'));

    const devList = store.getAll('developer');
    assert.strictEqual(devList.length, 2, 'developer channel should see both');
  });

  await check('public checkForUpdate cannot surface a developer build', async () => {
    const storePath = path.join(dir, 'updates2.json');
    fs.writeFileSync(storePath, '[]');
    const store = new UpdateStore(storePath);
    store.publish({
      version: '9.9.9',
      channel: 'developer',
      title: 'Secret',
      description: 'dev',
      changelog: ['x'],
      packageUrl: 'https://github.com/Rare-Erudite/COMPLETED/releases/download/v9/s.bin',
      platform: 'web',
      artifactSizeBytes: 4,
      sha256: sha256(Buffer.from('RARE')),
      publishedBy: 'dev',
    });
    const checkResult = store.checkForUpdate('1.0.0', 'public');
    assert.strictEqual(checkResult.hasUpdate, false, 'public user must not see a developer build');
    assert.strictEqual(checkResult.update, null);
  });

  await check('publish rejects a non-HTTPS or off-repo artifact URL', async () => {
    const storePath = path.join(dir, 'updates3.json');
    fs.writeFileSync(storePath, '[]');
    const store = new UpdateStore(storePath);
    const base = {
      version: '1.0.0', channel: 'public' as const, title: 't', description: 'd', changelog: ['c'],
      platform: 'web' as const, artifactSizeBytes: 4, sha256: sha256(Buffer.from('RARE')), publishedBy: 'x',
    };
    assert.throws(
      () => store.publish({ ...base, packageUrl: 'http://github.com/Rare-Erudite/COMPLETED/releases/download/v1/a.bin' }),
      /HTTPS|configured/i,
    );
    assert.throws(
      () => store.publish({ ...base, packageUrl: 'https://evil.example.com/a.bin' }),
      /configured/i,
    );
    assert.throws(
      () => store.publish({ ...base, packageUrl: 'https://github.com/Rare-Erudite/COMPLETED/releases/download/v1/a.bin', sha256: 'nothex' }),
      /SHA-256/i,
    );
  });

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`  → ${pass} passed, ${fail} failed\n`);
  if (fail > 0) throw new Error(`${fail} update assertion(s) failed.`);
}
