/**
 * LinkResolver — turn a shared link into retrievable content.
 *
 * A link is not a document. Google Drive, OneDrive, Dropbox and YouTube each
 * expose files through a different mechanism, and a private file cannot be read
 * by simply fetching its page URL. This module recognises the service, rewrites
 * the link into that service's direct-download form where one exists, and — when
 * a direct form does not exist without the owner's account — reports exactly
 * that instead of saving an HTML login page and calling it a document.
 *
 * Media that needs speech-to-text is handed to the transcription pipeline rather
 * than being treated as unreadable.
 */

export type LinkService =
  | 'google-drive'
  | 'onedrive'
  | 'dropbox'
  | 'youtube'
  | 'direct-file'
  | 'webpage'
  | 'unsupported';

export interface ResolvedLink {
  service: LinkService;
  label: string;
  /** URL to actually fetch, when the link can be resolved to a fetchable form. */
  fetchUrl?: string;
  /** True when the resulting payload is media that must be transcribed. */
  media: boolean;
  /** Whether this needs the user's own account to work. */
  requiresAccount: boolean;
  /** Direct, actionable explanation when the link cannot be fetched here. */
  blocker?: string;
  /** Original URL, always preserved. */
  sourceUrl: string;
  warnings: string[];
}

const YOUTUBE_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com',
]);

function hostOf(url: URL): string {
  return url.hostname.toLowerCase();
}

function idFromYouTube(url: URL): string | null {
  const host = hostOf(url);
  if (!YOUTUBE_HOSTS.has(host)) return null;
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return id || null;
  }
  const v = url.searchParams.get('v');
  if (v) return v;
  const shorts = url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/);
  return shorts?.[1] || null;
}

/**
 * Google Drive: /file/d/<id>/view → /uc?export=download&id=<id>
 * Docs/Sheets/Slides need an export URL instead, and native Docs cannot be
 * exported without the account, so that is reported honestly.
 */
function resolveGoogleDrive(url: URL): ResolvedLink {
  const warnings: string[] = [];
  const fileMatch = url.pathname.match(/\/file\/d\/([\w-]{10,})/);
  const id = fileMatch?.[1] || url.searchParams.get('id');

  const isNativeDoc = /\/(document|spreadsheets|presentation)\/d\/([\w-]{10,})/.test(url.pathname);
  if (isNativeDoc) {
    const nativeMatch = url.pathname.match(/\/(document|spreadsheets|presentation)\/d\/([\w-]{10,})/);
    const kind = nativeMatch![1];
    const nativeId = nativeMatch![2];
    const exportFormat: Record<string, { format: string; mime: string }> = {
      document: { format: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      spreadsheets: { format: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      presentation: { format: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
    };
    const target = exportFormat[kind];
    return {
      service: 'google-drive',
      label: `Google ${kind === 'document' ? 'Docs' : kind === 'spreadsheets' ? 'Sheets' : 'Slides'} file`,
      fetchUrl: `https://docs.google.com/${kind}/d/${nativeId}/export?format=${target.format}`,
      media: false,
      requiresAccount: false,
      sourceUrl: url.toString(),
      warnings: [
        'Google exports native Docs/Sheets/Slides only when the file is shared publicly or with link access; otherwise the export returns a sign-in page.',
      ],
    };
  }

  if (!id) {
    return {
      service: 'google-drive',
      label: 'Google Drive link',
      media: false,
      requiresAccount: true,
      blocker:
        'This Drive link does not contain a file id, so it points at a folder or an invalid item. Open the file in Drive, use Share, and copy the file link.',
      sourceUrl: url.toString(),
      warnings,
    };
  }

  return {
    service: 'google-drive',
    label: 'Google Drive file',
    fetchUrl: `https://drive.google.com/uc?export=download&id=${id}`,
    media: false,
    requiresAccount: false,
    sourceUrl: url.toString(),
    warnings: [
      'Drive downloads work only for files shared as "Anyone with the link". A private file will return a sign-in page, which RARE reports rather than saving.',
    ],
  };
}

/** OneDrive: `?download=1` selects the download form of a shared item. */
function resolveOneDrive(url: URL): ResolvedLink {
  const host = hostOf(url);
  const isShareLink = /1drv\.ms$/.test(host) || url.pathname.includes('/:');
  const downloadUrl = new URL(url.toString());
  downloadUrl.searchParams.set('download', '1');

  return {
    service: 'onedrive',
    label: isShareLink ? 'OneDrive shared item' : 'OneDrive file',
    fetchUrl: downloadUrl.toString(),
    media: false,
    requiresAccount: false,
    sourceUrl: url.toString(),
    warnings: [
      'OneDrive downloads work only when the item is shared with a link that allows anonymous access.',
    ],
  };
}

/** Dropbox: `?dl=1` returns the file instead of the preview page. */
function resolveDropbox(url: URL): ResolvedLink {
  const downloadUrl = new URL(url.toString());
  downloadUrl.searchParams.set('dl', '1');
  return {
    service: 'dropbox',
    label: 'Dropbox file',
    fetchUrl: downloadUrl.toString(),
    media: false,
    requiresAccount: false,
    sourceUrl: url.toString(),
    warnings: ['Dropbox downloads work only for links shared with "Anyone with the link".'],
  };
}

/** YouTube: the page is HTML, so the video has to be fetched by a media tool. */
function resolveYouTube(url: URL): ResolvedLink {
  const id = idFromYouTube(url);
  if (!id) {
    return {
      service: 'youtube',
      label: 'YouTube link',
      media: true,
      requiresAccount: false,
      blocker: 'No video id could be found in this YouTube URL.',
      sourceUrl: url.toString(),
      warnings: [],
    };
  }
  return {
    service: 'youtube',
    label: 'YouTube video',
    // yt-dlp understands the canonical watch URL and selects the best audio.
    fetchUrl: `https://www.youtube.com/watch?v=${id}`,
    media: true,
    requiresAccount: false,
    sourceUrl: url.toString(),
    warnings: [
      'YouTube audio is downloaded for transcription only. Only transcribe material you have the right to use.',
    ],
  };
}

const FILE_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'tsv', 'txt', 'md', 'rtf', 'html', 'htm',
  'xml', 'json', 'yaml', 'yml', 'pptx', 'ppt', 'odt', 'ods', 'odp', 'epub', 'zip', 'gz',
  'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'mp4', 'mov', 'webm', 'mkv', 'avi',
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'tiff', 'bmp', 'srt', 'vtt', 'eml',
]);

const MEDIA_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'mp4', 'mov', 'webm', 'mkv', 'avi']);

/** Work out how a link should be retrieved. Pure function — no network access. */
export function resolveLink(rawUrl: string): ResolvedLink {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return {
      service: 'unsupported',
      label: 'Invalid link',
      media: false,
      requiresAccount: false,
      blocker: 'That is not a valid URL.',
      sourceUrl: rawUrl,
      warnings: [],
    };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return {
      service: 'unsupported',
      label: 'Unsupported scheme',
      media: false,
      requiresAccount: false,
      blocker: `Only http and https links can be retrieved; this is ${url.protocol}`,
      sourceUrl: rawUrl,
      warnings: [],
    };
  }

  const host = hostOf(url);
  if (YOUTUBE_HOSTS.has(host)) return resolveYouTube(url);
  if (host === 'drive.google.com' || host === 'docs.google.com') return resolveGoogleDrive(url);
  if (/\.sharepoint\.com$/.test(host) || /1drv\.ms$/.test(host) || /onedrive\.live\.com$/.test(host) || /\.microsoftusercontent\.com$/.test(host)) {
    return resolveOneDrive(url);
  }
  if (/\.dropbox\.com$/.test(host) || /\.dropboxusercontent\.com$/.test(host)) return resolveDropbox(url);
  if (host === 'github.com' && /\/blob\//.test(url.pathname)) {
    // GitHub serves raw content from a different host path.
    const raw = url.toString().replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
    return {
      service: 'direct-file',
      label: 'GitHub file',
      fetchUrl: raw,
      media: false,
      requiresAccount: false,
      sourceUrl: rawUrl,
      warnings: [],
    };
  }

  const extension = (url.pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1] || '').toLowerCase();
  if (FILE_EXTENSIONS.has(extension)) {
    return {
      service: 'direct-file',
      label: `Direct .${extension} file`,
      fetchUrl: url.toString(),
      media: MEDIA_EXTENSIONS.has(extension),
      requiresAccount: false,
      sourceUrl: rawUrl,
      warnings: [],
    };
  }

  return {
    service: 'webpage',
    label: 'Web page',
    fetchUrl: url.toString(),
    media: false,
    requiresAccount: false,
    sourceUrl: rawUrl,
    warnings: [],
  };
}

/** Human-readable explanation for a link that cannot be fetched as-is. */
export function describeLinkBlock(resolved: ResolvedLink): string | null {
  if (resolved.blocker) return resolved.blocker;
  return null;
}

/**
 * Download a YouTube/streaming URL's audio to a buffer, for transcription.
 *
 * yt-dlp is invoked as a subprocess with a hard timeout and an output cap. When
 * the binary is absent the caller is told, rather than being handed an empty
 * buffer.
 */
export async function downloadMediaFromLink(
  url: string,
  options: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<{ ok: boolean; buffer?: Buffer; error?: string; title?: string; durationSeconds?: number }> {
  const { execFile } = await import('child_process');
  const fs = await import('fs/promises');
  const os = await import('os');
  const path = await import('path');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  const maxBytes = options.maxBytes ?? 400 * 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;

  try {
    await execFileAsync('yt-dlp', ['--version'], { timeout: 10_000 });
  } catch {
    return {
      ok: false,
      error: 'yt-dlp is not installed in this runtime, so media links cannot be downloaded.',
    };
  }

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rare-link-'));
  try {
    const template = path.join(directory, 'media.%(ext)s');
    const { stdout: metaJson } = await execFileAsync(
      'yt-dlp',
      ['--no-playlist', '--dump-single-json', '--no-warnings', url],
      { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
    );
    let title: string | undefined;
    let durationSeconds: number | undefined;
    try {
      const meta = JSON.parse(metaJson);
      title = typeof meta.title === 'string' ? meta.title : undefined;
      durationSeconds = typeof meta.duration === 'number' ? meta.duration : undefined;
      if (typeof meta.filesize === 'number' && meta.filesize > maxBytes) {
        return {
          ok: false,
          error: `That media is ${(meta.filesize / 1024 / 1024).toFixed(0)} MB, above the ${(maxBytes / 1024 / 1024).toFixed(0)} MB limit.`,
          title,
          durationSeconds,
        };
      }
    } catch {
      // Metadata is optional; the download below is what matters.
    }

    await execFileAsync(
      'yt-dlp',
      [
        '--no-playlist',
        '-f', 'bestaudio/best',
        '-x', '--audio-format', 'mp3', '--audio-quality', '5',
        '--max-filesize', String(maxBytes),
        '--no-warnings',
        '-o', template,
        url,
      ],
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
    );

    const files = await fs.readdir(directory);
    const audio = files.find((name) => /\.(mp3|m4a|webm|opus|wav)$/i.test(name));
    if (!audio) {
      return { ok: false, error: 'yt-dlp reported success but produced no audio file.', title, durationSeconds };
    }
    const buffer = await fs.readFile(path.join(directory, audio));
    if (buffer.length === 0) {
      return { ok: false, error: 'The downloaded audio was empty.', title, durationSeconds };
    }
    if (buffer.length > maxBytes) {
      return {
        ok: false,
        error: `The downloaded audio is ${(buffer.length / 1024 / 1024).toFixed(0)} MB, above the limit.`,
        title,
        durationSeconds,
      };
    }
    return { ok: true, buffer, title, durationSeconds };
  } catch (error) {
    return {
      ok: false,
      error: `The media could not be downloaded: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown error'}`,
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
