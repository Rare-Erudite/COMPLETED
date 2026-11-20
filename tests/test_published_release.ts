import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { resolvePublishedApk } from '../src/server/storage/PublishedRelease.js';

const SHA = 'a'.repeat(64);
const TAG = 'rare-final-v2.0.0';
const APK = 'rare-v2.0.0-release.apk';
const ROOT = `https://github.com/Rare-Erudite/COMPLETED/releases/download/${TAG}/`;

// The real release family in this repository is `vX.Y.Z-android`, not
// `rare-final-vX.Y.Z`. The resolver must accept both.
const REAL_TAG = 'v1.1.1-android';
const REAL_APK = 'rare-v1.1.1-release.apk';
const REAL_ROOT = `https://github.com/Rare-Erudite/COMPLETED/releases/download/${REAL_TAG}/`;
const REAL_BYTES = Buffer.from('fake-apk-bytes-for-checksum');
const REAL_SHA = crypto.createHash('sha256').update(REAL_BYTES).digest('hex');

export async function runPublishedReleaseTests(): Promise<void> {
  console.log('\n[published-release]');

  const validFetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url === 'https://api.github.com/repos/Rare-Erudite/COMPLETED/releases/latest') {
      return new Response(JSON.stringify({
        tag_name: TAG,
        published_at: '2026-11-06T12:00:00.000Z',
        assets: [
          { name: APK, size: 8192, browser_download_url: `${ROOT}${APK}` },
          { name: `${APK}.sha256`, size: 94, browser_download_url: `${ROOT}${APK}.sha256` },
        ],
      }), { status: 200 });
    }
    if (url === `${ROOT}${APK}.sha256`) return new Response(`${SHA}  ${APK}\n`, { status: 200 });
    return new Response('missing', { status: 404 });
  };
  const resolved = await resolvePublishedApk(validFetcher);
  assert.deepEqual(resolved, {
    url: `${ROOT}${APK}`,
    filename: APK,
    size: 8192,
    sha256: SHA,
    version: '2.0.0',
    releaseDate: '2026-11-06T12:00:00.000Z',
  });
  console.log('  ✓ official APK metadata and matching SHA-256 checksum are resolved');

  // The real published tag family must resolve, and with no .sha256 asset the
  // checksum must be computed from the APK bytes rather than failing.
  const realFetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url === 'https://api.github.com/repos/Rare-Erudite/COMPLETED/releases/latest') {
      return new Response(JSON.stringify({
        tag_name: REAL_TAG,
        published_at: '2026-11-01T09:52:39.000Z',
        assets: [{ name: REAL_APK, size: REAL_BYTES.length, browser_download_url: `${REAL_ROOT}${REAL_APK}` }],
      }), { status: 200 });
    }
    if (url === `${REAL_ROOT}${REAL_APK}`) return new Response(REAL_BYTES, { status: 200 });
    return new Response('missing', { status: 404 });
  };
  const real = await resolvePublishedApk(realFetcher);
  assert.ok(real, 'the real vX.Y.Z-android tag family must resolve');
  assert.equal(real!.version, '1.1.1');
  assert.equal(real!.filename, REAL_APK);
  assert.equal(real!.sha256, REAL_SHA, 'checksum must be computed from the APK when no .sha256 asset exists');
  console.log('  ✓ real vX.Y.Z-android tags resolve and a missing checksum asset is computed from the APK');

  const wrongChecksumFetcher: typeof fetch = async (input) => {
    const response = await validFetcher(input);
    if (String(input) === `${ROOT}${APK}.sha256`) return new Response(`${SHA}  another.apk\n`, { status: 200 });
    return response;
  };
  // A malformed checksum asset falls back to computing the digest from the APK,
  // which the fake fetcher cannot serve, so resolution must fail closed.
  assert.equal(await resolvePublishedApk(wrongChecksumFetcher), null, 'a checksum naming the wrong file must not be trusted');

  const untrustedFetcher: typeof fetch = async (input) => {
    const response = await validFetcher(input);
    if (String(input) === 'https://api.github.com/repos/Rare-Erudite/COMPLETED/releases/latest') {
      return new Response(JSON.stringify({
        tag_name: TAG,
        assets: [
          { name: APK, size: 8192, browser_download_url: `https://evil.example/${APK}` },
          { name: `${APK}.sha256`, size: 94, browser_download_url: `${ROOT}${APK}.sha256` },
        ],
      }), { status: 200 });
    }
    return response;
  };
  assert.equal(await resolvePublishedApk(untrustedFetcher), null, 'asset must come from the official release path');
  console.log('  ✓ mismatched checksum filenames and untrusted asset URLs are rejected');
}
