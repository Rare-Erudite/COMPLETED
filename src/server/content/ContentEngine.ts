/**
 * ContentEngine — the single entry point for turning ANY source into
 * normalised, searchable text with provenance.
 *
 * Both the Documents workspace and the Research workspace call this. There is
 * exactly one fetcher (SafeFetcher), one sniffer (ContentSniffer) and one
 * extractor registry (Extractors) behind it, so a new format is added once.
 *
 * Flow: accept → identify → retrieve → select processor → attempt → fall back
 *       → normalise → record provenance/status → return.
 */

import { ContentKind, SniffResult, sniffContent } from './ContentSniffer.js';
import { ExtractionResult, ExtractedPage, extractorsFor, DEFAULT_MAX_CHARS } from './Extractors.js';
import { SafeFetchError, safeFetch } from './SafeFetcher.js';

export interface ContentSource {
  /** Where the bytes came from. */
  type: 'url' | 'file' | 'text';
  url?: string;
  filename?: string;
  mimeType?: string;
}

export interface ContentAttempt {
  extractor: string;
  method: string;
  ok: boolean;
  error?: string;
  chars?: number;
}

export interface ContentResult {
  ok: boolean;
  /** Normalised text. Empty when nothing could be extracted. */
  text: string;
  /** What the payload actually is. */
  kind: ContentKind;
  label: string;
  family: SniffResult['family'];
  mimeType: string;
  /** How the type was determined. */
  identification: string;
  /** Which extractor produced the text. */
  method: string;
  /** True when the text came from OCR/vision rather than embedded text. */
  ocr: boolean;
  /** Original URL (before redirects) and the final URL after redirects. */
  sourceUrl?: string;
  finalUrl?: string;
  redirectChain?: string[];
  title?: string;
  metadata: Record<string, unknown>;
  pages?: ExtractedPage[];
  tables?: Array<{ name: string; rows: string[][] }>;
  warnings: string[];
  /** Every extractor that was tried, in order. */
  attempts: ContentAttempt[];
  /** Bytes retrieved. */
  byteLength: number;
  truncated: boolean;
  /** Populated only when ok === false. */
  error?: { message: string; code: string; nextStep?: string };
  /** Wall-clock duration in ms. */
  durationMs: number;
}

export interface ProcessOptions {
  maxChars?: number;
  maxBytes?: number;
  timeoutMs?: number;
  /** Filename hint, used only as a tie-breaker for ambiguous text. */
  filename?: string;
  /** Declared MIME type, used only as a tie-breaker. */
  mimeType?: string;
  /** Skip OCR even if the text layer is empty (faster, less accurate). */
  allowOcr?: boolean;
}

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

function emptyResult(kind: ContentKind, label: string, family: SniffResult['family'], mimeType: string, identification: string): ContentResult {
  return {
    ok: false,
    text: '',
    kind,
    label,
    family,
    mimeType,
    identification,
    method: 'none',
    ocr: false,
    metadata: {},
    warnings: [],
    attempts: [],
    byteLength: 0,
    truncated: false,
    durationMs: 0,
  };
}

/**
 * Run the extractor chain for a buffer. Tries the primary adapter first, then
 * any fallback (e.g. PDF text layer → OCR) when the primary yields nothing.
 */
async function extractFromBuffer(
  buffer: Buffer,
  sniff: SniffResult,
  options: ProcessOptions,
): Promise<{ result: ExtractionResult | null; attempts: ContentAttempt[]; warnings: string[] }> {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const attempts: ContentAttempt[] = [];
  const warnings: string[] = [];
  const candidates = extractorsFor(sniff.kind);

  if (candidates.length === 0) {
    warnings.push(`No extractor is registered for ${sniff.label}.`);
    return { result: null, attempts, warnings };
  }

  let best: ExtractionResult | null = null;

  for (const extractor of candidates) {
    // OCR is opt-out and only used when the cheaper path produced nothing.
    if (extractor.ocr && options.allowOcr === false) {
      attempts.push({ extractor: extractor.id, method: extractor.method, ok: false, error: 'OCR disabled for this request.' });
      continue;
    }
    if (extractor.ocr && best && best.text.trim().length > 200) {
      attempts.push({ extractor: extractor.id, method: extractor.method, ok: false, error: 'Skipped: embedded text was already extracted.' });
      continue;
    }

    let available = false;
    try {
      available = await extractor.available();
    } catch {
      available = false;
    }
    if (!available) {
      attempts.push({ extractor: extractor.id, method: extractor.method, ok: false, error: 'Not available in this runtime.' });
      continue;
    }

    try {
      const result = await extractor.run({ buffer, filename: options.filename || '', mimeType: sniff.mimeType, maxChars });
      attempts.push({ extractor: extractor.id, method: extractor.method, ok: true, chars: result.text.length });
      warnings.push(...result.warnings);
      if (!best || result.text.trim().length > best.text.trim().length) best = result;
      // A non-OCR adapter that produced real text is good enough.
      if (!result.ocr && result.text.trim().length > 0) break;
    } catch (error) {
      attempts.push({
        extractor: extractor.id,
        method: extractor.method,
        ok: false,
        error: error instanceof Error ? error.message : 'Extractor failed.',
      });
    }
  }

  return { result: best, attempts, warnings };
}

function finalise(
  base: ContentResult,
  extraction: ExtractionResult | null,
  attempts: ContentAttempt[],
  warnings: string[],
): ContentResult {
  const uniqueWarnings = [...new Set(warnings)].slice(0, 40);
  if (!extraction || extraction.text.trim().length === 0) {
    return {
      ...base,
      ok: false,
      attempts,
      warnings: uniqueWarnings,
      error: {
        message: `No readable text could be extracted from this ${base.label}.`,
        code: 'NO_TEXT_EXTRACTED',
        nextStep:
          base.family === 'image'
            ? 'The image may contain no text, or OCR is unavailable on this server.'
            : base.family === 'audio' || base.family === 'video'
              ? 'Media needs a transcription provider; see the transcription endpoint.'
              : 'Try a different source, or convert the file to a supported format.',
      },
    };
  }
  return {
    ...base,
    ok: true,
    text: extraction.text,
    method: extraction.method,
    ocr: extraction.ocr,
    metadata: { ...base.metadata, ...extraction.metadata },
    pages: extraction.pages,
    tables: extraction.tables,
    attempts,
    warnings: uniqueWarnings,
    truncated: base.truncated || extraction.truncated,
  };
}

/** Process an in-memory buffer (uploaded file, attachment, saved artifact). */
export async function processBuffer(buffer: Buffer, options: ProcessOptions = {}): Promise<ContentResult> {
  const started = Date.now();
  const sniff = sniffContent(buffer, options.filename || '', options.mimeType || '');
  const base = emptyResult(sniff.kind, sniff.label, sniff.family, sniff.mimeType, sniff.evidence);
  base.byteLength = buffer.length;

  if (sniff.family === 'audio' || sniff.family === 'video') {
    return {
      ...base,
      durationMs: Date.now() - started,
      error: {
        message: `${sniff.label} is media, not text.`,
        code: 'MEDIA_REQUIRES_TRANSCRIPTION',
        nextStep: 'Send it to the transcription endpoint, which uses the configured speech provider.',
      },
    };
  }

  const { result, attempts, warnings } = await extractFromBuffer(buffer, sniff, options);
  const final = finalise(base, result, attempts, warnings);
  return { ...final, durationMs: Date.now() - started };
}

/** Process plain text supplied directly (no retrieval). */
export async function processText(text: string, options: ProcessOptions = {}): Promise<ContentResult> {
  const buffer = Buffer.from(text, 'utf8');
  return processBuffer(buffer, { ...options, filename: options.filename || 'input.txt' });
}

/**
 * Retrieve a URL and process whatever it actually returns. Redirects are
 * followed and revalidated; the final URL and the whole chain are preserved.
 */
export async function processUrl(rawUrl: string, options: ProcessOptions = {}): Promise<ContentResult> {
  const started = Date.now();
  let fetched;
  try {
    fetched = await safeFetch(rawUrl, {
      maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
      timeoutMs: options.timeoutMs ?? 20_000,
    });
  } catch (error) {
    const code = error instanceof SafeFetchError ? error.code : 'FETCH_FAILED';
    const base = emptyResult('unknown', 'Unreachable source', 'unknown', 'application/octet-stream', 'retrieval failed');
    return {
      ...base,
      sourceUrl: rawUrl,
      durationMs: Date.now() - started,
      error: {
        message: error instanceof Error ? error.message : 'The source could not be retrieved.',
        code,
        nextStep:
          code === 'PRIVATE_ADDRESS' || code === 'UNSAFE_SCHEME'
            ? 'Only public HTTPS URLs are allowed.'
            : 'Check that the URL is public and reachable, then try again.',
      },
    };
  }

  if (fetched.status < 200 || fetched.status >= 300) {
    const base = emptyResult('unknown', 'Source returned an error', 'unknown', fetched.contentType || 'application/octet-stream', `HTTP ${fetched.status}`);
    return {
      ...base,
      sourceUrl: rawUrl,
      finalUrl: fetched.finalUrl,
      redirectChain: fetched.redirectChain,
      byteLength: fetched.body.length,
      durationMs: Date.now() - started,
      error: {
        message: `The source returned HTTP ${fetched.status}.`,
        code: 'HTTP_ERROR',
        nextStep: 'The page may require authentication or may no longer exist.',
      },
    };
  }

  const filenameHint = (() => {
    try {
      return decodeURIComponent(new URL(fetched.finalUrl).pathname.split('/').pop() || '');
    } catch {
      return '';
    }
  })();

  const sniff = sniffContent(fetched.body, filenameHint, fetched.contentType);
  const base = emptyResult(sniff.kind, sniff.label, sniff.family, sniff.mimeType, sniff.evidence);
  base.sourceUrl = rawUrl;
  base.finalUrl = fetched.finalUrl;
  base.redirectChain = fetched.redirectChain;
  base.byteLength = fetched.body.length;
  base.truncated = fetched.truncated;

  if (sniff.family === 'audio' || sniff.family === 'video') {
    return {
      ...base,
      durationMs: Date.now() - started,
      error: {
        message: `The URL points to ${sniff.label}, not a text document.`,
        code: 'MEDIA_REQUIRES_TRANSCRIPTION',
        nextStep: 'Use the transcription endpoint on this URL.',
      },
    };
  }

  const { result, attempts, warnings } = await extractFromBuffer(fetched.body, sniff, {
    ...options,
    filename: options.filename || filenameHint,
  });
  if (fetched.truncated) warnings.push(`The source exceeded the ${Math.round((options.maxBytes ?? DEFAULT_MAX_BYTES) / 1024 / 1024)} MB retrieval limit and was truncated.`);

  const final = finalise(base, result, attempts, warnings);
  const title = typeof final.metadata.title === 'string' ? final.metadata.title : undefined;
  return { ...final, title, durationMs: Date.now() - started };
}

// ---------------------------------------------------------------------------
// Chunking — page/section aware, for indexing and retrieval
// ---------------------------------------------------------------------------

export interface ContentChunk {
  index: number;
  text: string;
  /** 1-based page number when the source has pages. */
  page?: number;
  /** Nearest heading/section label when known. */
  section?: string;
  charStart: number;
  charEnd: number;
}

const CHUNK_TARGET_CHARS = 1400;
const CHUNK_OVERLAP_CHARS = 200;

/**
 * Split extracted content into overlapping chunks, preserving page numbers and
 * the nearest heading so a search hit can be opened at the right place.
 */
export function chunkContent(result: ContentResult, targetChars = CHUNK_TARGET_CHARS): ContentChunk[] {
  const chunks: ContentChunk[] = [];
  let cursor = 0;

  const pushChunk = (text: string, page: number | undefined, section: string | undefined, start: number, end: number) => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    chunks.push({ index: chunks.length, text: trimmed, page, section, charStart: start, charEnd: end });
  };

  if (result.pages && result.pages.length > 0) {
    for (const page of result.pages) {
      const pageText = page.text;
      if (!pageText.trim()) continue;
      let offset = 0;
      while (offset < pageText.length) {
        const end = Math.min(pageText.length, offset + targetChars);
        const slice = pageText.slice(offset, end);
        const heading = slice.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim();
        pushChunk(slice, page.page, heading, cursor + offset, cursor + end);
        if (end >= pageText.length) break;
        offset = Math.max(offset + 1, end - CHUNK_OVERLAP_CHARS);
      }
      cursor += pageText.length + 2;
    }
    return chunks;
  }

  const text = result.text;
  let currentSection: string | undefined;
  let offset = 0;
  while (offset < text.length) {
    const end = Math.min(text.length, offset + targetChars);
    const slice = text.slice(offset, end);
    const heading = slice.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim();
    if (heading) currentSection = heading;
    pushChunk(slice, undefined, currentSection, offset, end);
    if (end >= text.length) break;
    offset = Math.max(offset + 1, end - CHUNK_OVERLAP_CHARS);
  }
  return chunks;
}

/** A short, human-readable summary of what happened, for UI and logs. */
export function describeResult(result: ContentResult): string {
  if (!result.ok) return result.error?.message || 'Processing failed.';
  const parts = [`${result.label} read via ${result.method}`];
  if (result.ocr) parts.push('OCR-derived text');
  if (result.pages?.length) parts.push(`${result.pages.length} page(s)`);
  parts.push(`${result.text.length.toLocaleString()} chars`);
  if (result.truncated) parts.push('truncated');
  return parts.join(' · ');
}
