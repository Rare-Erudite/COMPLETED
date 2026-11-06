import assert from 'node:assert/strict';
import { resolvePublishedApk } from '../src/server/storage/PublishedRelease.js';

const SHA = 'a'.repeat(64);
const TAG = 'rare-final-v2.0.0';
const APK = 'rare-v2.0.0-release.apk';
const ROOT = `https://github.com/Rare-Erudite/COMPLETED/releases/download/${TAG}/`;

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

  const wrongChecksumFetcher: typeof fetch = async (input) => {
    const response = await validFetcher(input);
    if (String(input) === `${ROOT}${APK}.sha256`) return new Response(`${SHA}  another.apk\n`, { status: 200 });
    return response;
  };
  assert.equal(await resolvePublishedApk(wrongChecksumFetcher), null, 'checksum must name the expected APK');

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
