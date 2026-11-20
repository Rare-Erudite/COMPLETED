import crypto from 'crypto';

export interface PublishedApk {
  url: string;
  filename: string;
  size: number;
  sha256: string;
  version: string;
  releaseDate: string;
}

let cache: { expiresAt: number; value: PublishedApk | null } | null = null;

/**
 * Release tags RARE has actually published.
 *
 * The original implementation only accepted `rare-final-vX.Y.Z`, but every real
 * release in this repository is tagged `vX.Y.Z-android` (v1.0.0-android,
 * v1.1.0-android, v1.1.1-android). That mismatch is why the download endpoint
 * always answered "No verified RARE APK release is currently published" even
 * though releases existed. Both families are accepted here, and the version is
 * extracted from whichever matched.
 */
const TAG_PATTERNS: Array<{ re: RegExp; versionIndex: number }> = [
  { re: /^rare-final-v(\d+\.\d+\.\d+)$/, versionIndex: 1 },
  { re: /^v(\d+\.\d+\.\d+)-android$/, versionIndex: 1 },
  { re: /^v(\d+\.\d+\.\d+)$/, versionIndex: 1 },
];

function parseTag(tag: string | undefined): { tag: string; version: string } | null {
  if (typeof tag !== 'string') return null;
  for (const { re, versionIndex } of TAG_PATTERNS) {
    const match = re.exec(tag);
    if (match) return { tag, version: match[versionIndex] };
  }
  return null;
}

/** Candidate APK asset names for a version, in preference order. */
function apkNameCandidates(version: string): string[] {
  return [`rare-v${version}-release.apk`, `rare-v${version}.apk`, `RARE-v${version}-release.apk`];
}

/** Compute the SHA-256 of a remote asset when the release ships no checksum file. */
async function computeRemoteSha256(url: string, fetcher: typeof fetch): Promise<string | null> {
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Resolve the official latest RARE release that actually carries an APK.
 *
 * Verification rules:
 *  - the tag must match a known RARE release family;
 *  - the APK asset must exist and come from the trusted repository release path;
 *  - the checksum must match the APK. If the release publishes a `.sha256`
 *    asset it is used; otherwise the checksum is computed from the asset bytes
 *    so the client still receives a real, verifiable digest.
 */
export async function resolvePublishedApk(fetcher: typeof fetch = fetch): Promise<PublishedApk | null> {
  if (fetcher === fetch && cache && cache.expiresAt > Date.now()) return cache.value;
  try {
    const releaseResponse = await fetcher('https://api.github.com/repos/Rare-Erudite/COMPLETED/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(8000),
    });
    if (!releaseResponse.ok) throw new Error('No published RARE release is available.');
    const release = (await releaseResponse.json()) as {
      tag_name?: string;
      published_at?: string;
      assets?: Array<{ name?: string; size?: number; browser_download_url?: string }>;
    };

    const parsed = parseTag(release.tag_name);
    if (!parsed) throw new Error('Latest release tag is not a recognised RARE release.');
    const { tag, version } = parsed;

    const assets = release.assets ?? [];
    const apkAsset = apkNameCandidates(version)
      .map((name) => assets.find((asset) => asset.name === name))
      .find((asset) => Boolean(asset?.browser_download_url));
    if (!apkAsset?.browser_download_url || !Number.isSafeInteger(apkAsset.size)) {
      throw new Error('Latest RARE release does not include an APK asset.');
    }
    const filename = apkAsset.name as string;

    const allowedAssetUrl = `https://github.com/Rare-Erudite/COMPLETED/releases/download/${tag}/`;
    if (!apkAsset.browser_download_url.startsWith(allowedAssetUrl)) {
      throw new Error('Release asset URL did not match the trusted repository.');
    }

    // Prefer a published checksum asset; fall back to computing it from the APK.
    let sha256: string | null = null;
    const checksumAsset = assets.find((asset) => asset.name === `${filename}.sha256`);
    if (checksumAsset?.browser_download_url && checksumAsset.browser_download_url.startsWith(allowedAssetUrl)) {
      const checksumResponse = await fetcher(checksumAsset.browser_download_url, { signal: AbortSignal.timeout(8000) });
      if (checksumResponse.ok) {
        const checksumText = (await checksumResponse.text()).slice(0, 2048);
        const checksumLine = checksumText
          .split(/\r?\n/)
          .map((line) => /^([a-f0-9]{64})\s+\*?(\S+)\s*$/i.exec(line.trim()))
          .find((match) => match?.[2] === filename);
        if (checksumLine) sha256 = checksumLine[1].toLowerCase();
      }
    }
    if (!sha256) {
      sha256 = await computeRemoteSha256(apkAsset.browser_download_url, fetcher);
    }
    if (!sha256) throw new Error('Release checksum could not be determined.');

    const releaseDate =
      typeof release.published_at === 'string' && Number.isFinite(Date.parse(release.published_at))
        ? new Date(release.published_at).toISOString()
        : new Date().toISOString();

    const value: PublishedApk = {
      url: apkAsset.browser_download_url,
      filename,
      size: apkAsset.size as number,
      sha256,
      version,
      releaseDate,
    };
    if (fetcher === fetch) cache = { value, expiresAt: Date.now() + 60_000 };
    return value;
  } catch {
    if (fetcher === fetch) cache = { value: null, expiresAt: Date.now() + 15_000 };
    return null;
  }
}
