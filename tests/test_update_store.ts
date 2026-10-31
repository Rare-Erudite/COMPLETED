/**
 * Regression tests for the release/update store.
 *
 * Defect: every seeded release was silently dropped by isValidStoredUpdate
 * because it required an absolute GitHub URL, a checksum and a byte size, while
 * the shipped knowledge/updates.json used a relative path and no checksum. The
 * result was that /api/updates/check could never report an update, so no
 * installed RARE app could ever be told a newer version existed.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UpdateStore } from '../src/server/storage/UpdateStore.js';

const SHA = 'a'.repeat(64);

function makeStore(): { store: UpdateStore; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-updates-'));
  const store = new UpdateStore(path.join(dir, 'updates.json'));
  return { store, dir };
}

export async function runUpdateStoreTests(): Promise<void> {
  console.log('\n[update-store]');

  // 1. A same-origin download path is a valid artifact location.
  {
    const { store, dir } = makeStore();
    const published = store.publish({
      version: '1.0.0',
      channel: 'public',
      title: 'RARE 1.0.0',
      description: 'release',
      changelog: ['first'],
      packageUrl: '/api/download/apk',
      platform: 'android',
      artifactSizeBytes: 247387,
      sha256: SHA,
    });
    assert.equal(published.version, '1.0.0');
    assert.equal(published.packageUrl, '/api/download/apk');
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('  \u2713 a same-origin /api/download/apk artifact is accepted');
  }

  // 2. A trusted GitHub Releases URL is accepted.
  {
    const { store, dir } = makeStore();
    const url = 'https://github.com/Rare-Erudite/COMPLETED/releases/download/v1.0.0-android/rare.apk';
    const published = store.publish({
      version: '1.0.0',
      channel: 'public',
      title: 'RARE 1.0.0',
      description: 'release',
      changelog: ['first'],
      packageUrl: url,
      platform: 'android',
      artifactSizeBytes: 247387,
      sha256: SHA,
    });
    assert.equal(published.packageUrl, url);
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('  \u2713 a trusted GitHub Releases URL is accepted');
  }

  // 3. Untrusted artifact locations are rejected.
  for (const bad of [
    'https://evil.example.com/rare.apk',
    'https://github.com/SomeoneElse/OTHER/releases/download/v1/x.apk',
    'http://github.com/Rare-Erudite/COMPLETED/releases/download/v1/x.apk',
    '/api/admin/secret',
    'javascript:alert(1)',
  ]) {
    const { store, dir } = makeStore();
    assert.throws(
      () =>
        store.publish({
          version: '1.0.0',
          channel: 'public',
          title: 't',
          description: 'd',
          changelog: [],
          packageUrl: bad,
          platform: 'android',
          artifactSizeBytes: 1,
          sha256: SHA,
        }),
      /Release artifacts must be/,
      `rejects ${bad}`,
    );
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('  \u2713 untrusted artifact locations are rejected');

  // 4. A stored release survives a reload (the original defect dropped it).
  {
    const { store, dir } = makeStore();
    store.publish({
      version: '1.0.0',
      channel: 'public',
      title: 'RARE 1.0.0',
      description: 'release',
      changelog: ['first'],
      packageUrl: '/api/download/apk',
      platform: 'android',
      artifactSizeBytes: 247387,
      sha256: SHA,
    });
    const reloaded = new UpdateStore(path.join(dir, 'updates.json'));
    const list = reloaded.getAll('public');
    assert.equal(list.length, 1, 'the published release is still listed after reload');
    assert.equal(list[0].version, '1.0.0');
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('  \u2713 a published release survives a reload');
  }

  // 5. Version comparison drives hasUpdate correctly.
  {
    const { store, dir } = makeStore();
    store.publish({
      version: '1.0.0',
      channel: 'public',
      title: 'RARE 1.0.0',
      description: 'release',
      changelog: [],
      packageUrl: '/api/download/apk',
      platform: 'android',
      artifactSizeBytes: 247387,
      sha256: SHA,
    });
    assert.equal(store.checkForUpdate('0.9.0', 'public').hasUpdate, true, 'older client sees the update');
    assert.equal(store.checkForUpdate('1.0.0', 'public').hasUpdate, false, 'current client sees no update');
    assert.equal(store.checkForUpdate('1.1.0', 'public').hasUpdate, false, 'newer client sees no update');
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('  \u2713 hasUpdate reflects real version comparison');
  }
}
