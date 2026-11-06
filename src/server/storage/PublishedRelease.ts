export interface PublishedApk {
  url: string;
  filename: string;
  size: number;
  sha256: string;
  version: string;
  releaseDate: string;
}

let cache: { expiresAt: number; value: PublishedApk | null } | null = null;

/** Resolve only the official latest RARE release with a matching APK/checksum pair. */
export async function resolvePublishedApk(fetcher: typeof fetch = fetch): Promise<PublishedApk | null> {
  if (fetcher === fetch && cache && cache.expiresAt > Date.now()) return cache.value;
  try {
    const releaseResponse = await fetcher('https://api.github.com/repos/Rare-Erudite/COMPLETED/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(8000),
    });
    if (!releaseResponse.ok) throw new Error('No published RARE release is available.');
    const release = await releaseResponse.json() as {
      tag_name?: string;
      published_at?: string;
      assets?: Array<{ name?: string; size?: number; browser_download_url?: string }>;
    };
    const tag = typeof release.tag_name === 'string' && /^rare-final-v\d+\.\d+\.\d+$/.test(release.tag_name)
      ? release.tag_name : null;
    const version = tag?.slice('rare-final-v'.length);
    const filename = version ? `rare-v${version}-release.apk` : '';
    const apkAsset = release.assets?.find((asset) => asset.name === filename);
    const checksumAsset = release.assets?.find((asset) => asset.name === `${filename}.sha256`);
    if (!tag || !filename || !apkAsset?.browser_download_url || !Number.isSafeInteger(apkAsset.size) || !checksumAsset?.browser_download_url) {
      throw new Error('Latest RARE release does not include the APK and checksum assets.');
    }
    const allowedAssetUrl = `https://github.com/Rare-Erudite/COMPLETED/releases/download/${tag}/`;
    if (!apkAsset.browser_download_url.startsWith(allowedAssetUrl) || !checksumAsset.browser_download_url.startsWith(allowedAssetUrl)) {
      throw new Error('Release asset URL did not match the trusted repository.');
    }
    const checksumResponse = await fetcher(checksumAsset.browser_download_url, { signal: AbortSignal.timeout(8000) });
    if (!checksumResponse.ok) throw new Error('Release checksum could not be retrieved.');
    const checksumText = (await checksumResponse.text()).slice(0, 2048);
    const checksumLine = checksumText.split(/\r?\n/)
      .map((line) => /^([a-f0-9]{64})\s+\*?(\S+)\s*$/i.exec(line.trim()))
      .find((match) => match?.[2] === filename);
    if (!checksumLine) throw new Error('Release checksum asset is malformed.');
    const releaseDate = typeof release.published_at === 'string' && Number.isFinite(Date.parse(release.published_at))
      ? new Date(release.published_at).toISOString() : new Date().toISOString();
    const value = {
      url: apkAsset.browser_download_url,
      filename,
      size: apkAsset.size!,
      sha256: checksumLine[1].toLowerCase(),
      version: version!,
      releaseDate,
    };
    if (fetcher === fetch) cache = { value, expiresAt: Date.now() + 60_000 };
    return value;
  } catch {
    if (fetcher === fetch) cache = { value: null, expiresAt: Date.now() + 15_000 };
    return null;
  }
}
