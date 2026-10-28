/**
 * DocumentsService — the Documents workspace's server-side brain.
 *
 * Every read/write goes through the owner-scoped PersistentJsonStore, so a
 * document is only ever visible to the account that created it. Content
 * acquisition and parsing are delegated to the shared ContentEngine; this
 * service only handles library semantics (paths, versions, provenance,
 * derived links, search indexing).
 */

import path from 'path';
import { ContentResult, chunkContent, processBuffer, processUrl } from '../content/ContentEngine.js';
import { IndexedDocument, OwnerSearchIndexRegistry } from '../content/SearchIndex.js';

export interface DocumentRecord {
  path: string;
  content: string;
  format: string;
  updatedAt: string;
  /** Original source URL when the document was imported from the web. */
  sourceUrl?: string;
  /** Final URL after redirects. */
  finalUrl?: string;
  /** What the content actually is (from byte sniffing). */
  kind?: string;
  /** Human-readable label, e.g. "PDF document". */
  label?: string;
  /** Extractor that produced the text. */
  method?: string;
  /** True when the text came from OCR. */
  ocr?: boolean;
  /** Page-level text when the source had pages. */
  pages?: Array<{ page: number; text: string }>;
  /** Extraction warnings, verbatim. */
  warnings?: string[];
  /** Title discovered in the source (HTML <title>, EPUB dc:title, ...). */
  title?: string;
  /** Path of the document this was derived from (convert/transcript). */
  derivedFrom?: string;
  /** Monotonic version counter for this path. */
  version?: number;
  /** Previous contents, newest first, capped. */
  history?: Array<{ content: string; updatedAt: string; version: number }>;
  /** How this document came to exist. */
  origin?: 'manual' | 'upload' | 'url' | 'transcript' | 'research' | 'conversion';
}

export interface DocumentSummary {
  path: string;
  size: number;
  format: string;
  updated_at?: string;
  kind?: string;
  label?: string;
  title?: string;
  sourceUrl?: string;
  ocr?: boolean;
  origin?: DocumentRecord['origin'];
  version?: number;
}

export interface ImportOutcome {
  ok: boolean;
  path?: string;
  title?: string;
  kind?: string;
  label?: string;
  method?: string;
  ocr?: boolean;
  chars?: number;
  pages?: number;
  warnings?: string[];
  sourceUrl?: string;
  finalUrl?: string;
  error?: { message: string; code: string; nextStep?: string };
}

const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_HISTORY_ENTRIES = 5;
const GUEST_DOCUMENT_LIMIT = 20;

/** Extensions we can store as editable text. */
const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.text', '.json', '.html', '.htm', '.csv', '.xml', '.yaml', '.yml', '.log',
  '.tsv', '.srt', '.vtt', '.rtf', '.eml',
]);

export class DocumentPathError extends Error {}

/** Validate and normalise a document path. Never allows escaping the owner's space. */
export function normalizeDocumentPath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 500 || value.includes('\0')) {
    throw new DocumentPathError('Document path must be a valid relative path.');
  }
  if (path.isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    throw new DocumentPathError('Document path must be relative.');
  }
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.split('/').includes('..')) {
    throw new DocumentPathError('Document path must stay inside your document space.');
  }
  if (!TEXT_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase())) {
    throw new DocumentPathError(
      `Only text-based document formats can be stored (${[...TEXT_EXTENSIONS].join(', ')}). Convert other formats first.`,
    );
  }
  return normalized;
}

function slugify(value: string, fallback = 'document'): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}

/** Pick a stored extension for extracted text based on what the source was. */
function extensionForResult(result: ContentResult): string {
  switch (result.kind) {
    case 'html':
      return 'md';
    case 'json':
      return 'json';
    case 'csv':
    case 'tsv':
      return 'csv';
    case 'xml':
      return 'xml';
    case 'yaml':
      return 'yaml';
    case 'srt':
    case 'vtt':
      return 'srt';
    case 'markdown':
      return 'md';
    default:
      return 'md';
  }
}

export class DocumentsService {
  constructor(
    private readonly storage: { getOwnedState: <T>(ownerId: string, key: string, initial: T) => Promise<T>; updateOwnedState: <T>(ownerId: string, key: string, initial: T, update: (current: T) => T) => Promise<T> },
    private readonly indexes: OwnerSearchIndexRegistry,
  ) {}

  private async all(ownerId: string): Promise<DocumentRecord[]> {
    return this.storage.getOwnedState<DocumentRecord[]>(ownerId, 'documents', []);
  }

  async list(ownerId: string): Promise<DocumentSummary[]> {
    const documents = await this.all(ownerId);
    return documents.map((document) => ({
      path: document.path,
      size: Buffer.byteLength(document.content || '', 'utf8'),
      format: document.format,
      updated_at: document.updatedAt,
      kind: document.kind,
      label: document.label,
      title: document.title,
      sourceUrl: document.sourceUrl,
      ocr: document.ocr,
      origin: document.origin,
      version: document.version,
    }));
  }

  async read(ownerId: string, rawPath: string): Promise<DocumentRecord | null> {
    const documentPath = normalizeDocumentPath(rawPath);
    const documents = await this.all(ownerId);
    return documents.find((document) => document.path === documentPath) || null;
  }

  /** Save text, keeping a bounded version history so edits are recoverable. */
  async save(
    ownerId: string,
    rawPath: string,
    text: string,
    options: { isGuest?: boolean; origin?: DocumentRecord['origin']; derivedFrom?: string } = {},
  ): Promise<DocumentRecord> {
    const documentPath = normalizeDocumentPath(rawPath);
    if (typeof text !== 'string') throw new DocumentPathError('Document text must be a string.');
    if (Buffer.byteLength(text, 'utf8') > MAX_DOCUMENT_BYTES) {
      throw new DocumentPathError('Document text must be at most 2 MB.');
    }

    let saved: DocumentRecord | undefined;
    await this.storage.updateOwnedState<DocumentRecord[]>(ownerId, 'documents', [], (documents) => {
      const existing = documents.find((document) => document.path === documentPath);
      if (options.isGuest && !existing && documents.length >= GUEST_DOCUMENT_LIMIT) {
        throw new Error('RARE_GUEST_LIMIT');
      }
      const version = (existing?.version || 0) + 1;
      const history = existing
        ? [{ content: existing.content, updatedAt: existing.updatedAt, version: existing.version || 1 }, ...(existing.history || [])].slice(0, MAX_HISTORY_ENTRIES)
        : [];
      saved = {
        ...(existing || {}),
        path: documentPath,
        content: text,
        format: path.posix.extname(documentPath).slice(1).toLowerCase(),
        updatedAt: new Date().toISOString(),
        version,
        history,
        origin: options.origin || existing?.origin || 'manual',
        ...(options.derivedFrom ? { derivedFrom: options.derivedFrom } : {}),
      };
      return [saved, ...documents.filter((document) => document.path !== documentPath)];
    });

    if (!saved) throw new Error('The document could not be saved.');
    this.indexDocument(ownerId, saved);
    return saved;
  }

  /** Import a URL through the shared content engine. */
  async importUrl(
    ownerId: string,
    url: string,
    options: { isGuest?: boolean; requestedPath?: string; maxBytes?: number } = {},
  ): Promise<ImportOutcome> {
    const result = await processUrl(url, { maxBytes: options.maxBytes });
    if (!result.ok) {
      return {
        ok: false,
        sourceUrl: url,
        finalUrl: result.finalUrl,
        kind: result.kind,
        label: result.label,
        warnings: result.warnings,
        error: result.error,
      };
    }

    const extension = extensionForResult(result);
    const baseName = slugify(result.title || (() => {
      try {
        return decodeURIComponent(new URL(result.finalUrl || url).pathname.split('/').pop() || '');
      } catch {
        return 'import';
      }
    })().replace(/\.[^.]+$/, ''));
    const documentPath = normalizeDocumentPath(options.requestedPath || `imports/${baseName}-${Date.now()}.${extension}`);

    const saved = await this.save(ownerId, documentPath, result.text, { isGuest: options.isGuest, origin: 'url' });
    await this.storage.updateOwnedState<DocumentRecord[]>(ownerId, 'documents', [], (documents) =>
      documents.map((document) =>
        document.path === saved.path
          ? {
              ...document,
              sourceUrl: result.sourceUrl,
              finalUrl: result.finalUrl,
              kind: result.kind,
              label: result.label,
              method: result.method,
              ocr: result.ocr,
              pages: result.pages,
              warnings: result.warnings,
              title: result.title,
            }
          : document,
      ),
    );

    const refreshed = (await this.read(ownerId, saved.path)) || saved;
    this.indexDocument(ownerId, refreshed);

    return {
      ok: true,
      path: saved.path,
      title: result.title,
      kind: result.kind,
      label: result.label,
      method: result.method,
      ocr: result.ocr,
      chars: result.text.length,
      pages: result.pages?.length,
      warnings: result.warnings,
      sourceUrl: result.sourceUrl,
      finalUrl: result.finalUrl,
    };
  }

  /** Import an uploaded file through the shared content engine. */
  async importBuffer(
    ownerId: string,
    buffer: Buffer,
    filename: string,
    options: { isGuest?: boolean; mimeType?: string } = {},
  ): Promise<ImportOutcome> {
    const result = await processBuffer(buffer, { filename, mimeType: options.mimeType });
    if (!result.ok) {
      return {
        ok: false,
        kind: result.kind,
        label: result.label,
        warnings: result.warnings,
        error: result.error,
      };
    }
    const extension = extensionForResult(result);
    const baseName = slugify(filename.replace(/\.[^.]+$/, ''));
    const documentPath = normalizeDocumentPath(`uploads/${baseName}-${Date.now()}.${extension}`);
    const saved = await this.save(ownerId, documentPath, result.text, { isGuest: options.isGuest, origin: 'upload' });
    await this.storage.updateOwnedState<DocumentRecord[]>(ownerId, 'documents', [], (documents) =>
      documents.map((document) =>
        document.path === saved.path
          ? {
              ...document,
              kind: result.kind,
              label: result.label,
              method: result.method,
              ocr: result.ocr,
              pages: result.pages,
              warnings: result.warnings,
              title: result.title,
            }
          : document,
      ),
    );
    const refreshed = (await this.read(ownerId, saved.path)) || saved;
    this.indexDocument(ownerId, refreshed);
    return {
      ok: true,
      path: saved.path,
      title: result.title,
      kind: result.kind,
      label: result.label,
      method: result.method,
      ocr: result.ocr,
      chars: result.text.length,
      pages: result.pages?.length,
      warnings: result.warnings,
    };
  }

  /**
   * Import several URLs, deduplicating by final URL and reporting per-item
   * outcomes so a partial failure never looks like a total success.
   */
  async importMany(
    ownerId: string,
    urls: string[],
    options: { isGuest?: boolean; limit?: number; maxBytes?: number } = {},
  ): Promise<{ results: ImportOutcome[]; visited: string[]; failed: number; succeeded: number }> {
    const limit = Math.max(1, Math.min(20, options.limit ?? 8));
    const unique = [...new Set(urls.map((url) => url.trim()).filter(Boolean))].slice(0, limit);
    const results: ImportOutcome[] = [];
    const seenFinal = new Set<string>();
    let succeeded = 0;
    let failed = 0;

    for (const url of unique) {
      const outcome = await this.importUrl(ownerId, url, { isGuest: options.isGuest, maxBytes: options.maxBytes });
      if (outcome.ok && outcome.finalUrl) {
        if (seenFinal.has(outcome.finalUrl)) {
          results.push({ ...outcome, ok: false, error: { message: 'Duplicate of an earlier source (same final URL).', code: 'DUPLICATE' } });
          failed += 1;
          continue;
        }
        seenFinal.add(outcome.finalUrl);
      }
      if (outcome.ok) succeeded += 1;
      else failed += 1;
      results.push(outcome);
    }

    return { results, visited: unique, failed, succeeded };
  }

  /** Convert a stored document to another text format, preserving the original. */
  async convert(ownerId: string, rawPath: string, targetFormat: string): Promise<{ originalPath: string; convertedPath: string; format: string }> {
    const document = await this.read(ownerId, rawPath);
    if (!document) throw new DocumentPathError('Document not found.');
    const format = String(targetFormat || '').toLowerCase().replace(/^\./, '');
    if (!['txt', 'md', 'json', 'html', 'csv'].includes(format)) {
      throw new DocumentPathError(`Conversion to .${format} is not supported. Supported: txt, md, json, html, csv.`);
    }
    const convertedPath = normalizeDocumentPath(document.path.replace(/\.[^/.]+$/, `.${format}`));
    const converted = convertText(document.content, format);
    const saved = await this.save(ownerId, convertedPath, converted, { origin: 'conversion', derivedFrom: document.path });
    return { originalPath: document.path, convertedPath: saved.path, format };
  }

  /** Delete a document and evict it from the search index. */
  async remove(ownerId: string, rawPath: string): Promise<boolean> {
    const documentPath = normalizeDocumentPath(rawPath);
    let removed = false;
    await this.storage.updateOwnedState<DocumentRecord[]>(ownerId, 'documents', [], (documents) =>
      documents.filter((document) => {
        if (document.path === documentPath) {
          removed = true;
          return false;
        }
        return true;
      }),
    );
    if (removed) this.indexes.forOwner(ownerId).remove(documentPath);
    return removed;
  }

  /** Rename a document, keeping its content and history. */
  async rename(ownerId: string, rawPath: string, newPath: string): Promise<DocumentRecord> {
    const source = normalizeDocumentPath(rawPath);
    const target = normalizeDocumentPath(newPath);
    const document = await this.read(ownerId, source);
    if (!document) throw new DocumentPathError('Document not found.');
    const existing = await this.read(ownerId, target);
    if (existing) throw new DocumentPathError('A document already exists at that path.');
    await this.remove(ownerId, source);
    const saved = await this.save(ownerId, target, document.content, { origin: document.origin });
    await this.storage.updateOwnedState<DocumentRecord[]>(ownerId, 'documents', [], (documents) =>
      documents.map((item) =>
        item.path === saved.path
          ? { ...item, ...document, path: target, updatedAt: new Date().toISOString() }
          : item,
      ),
    );
    const refreshed = (await this.read(ownerId, target)) || saved;
    this.indexDocument(ownerId, refreshed);
    return refreshed;
  }

  /** Rebuild this owner's search index from persisted documents. */
  async reindex(ownerId: string): Promise<{ documents: number; chunks: number }> {
    const documents = await this.all(ownerId);
    const indexed: IndexedDocument[] = documents.map((document) => this.toIndexed(document));
    const index = this.indexes.forOwner(ownerId);
    index.rebuild(indexed);
    return { documents: indexed.length, chunks: indexed.reduce((sum, document) => sum + document.chunks.length, 0) };
  }

  /** Ensure the owner's index is populated (cheap no-op once built). */
  async ensureIndexed(ownerId: string): Promise<void> {
    const index = this.indexes.forOwner(ownerId);
    if (index.size > 0) return;
    await this.reindex(ownerId);
  }

  private indexDocument(ownerId: string, document: DocumentRecord): void {
    this.indexes.forOwner(ownerId).upsert(this.toIndexed(document));
  }

  private toIndexed(document: DocumentRecord): IndexedDocument {
    const result: ContentResult = {
      ok: true,
      text: document.content,
      kind: (document.kind as any) || 'text',
      label: document.label || 'Document',
      family: 'text',
      mimeType: 'text/plain',
      identification: 'stored document',
      method: document.method || 'stored',
      ocr: Boolean(document.ocr),
      metadata: {},
      pages: document.pages,
      warnings: document.warnings || [],
      attempts: [],
      byteLength: Buffer.byteLength(document.content, 'utf8'),
      truncated: false,
      durationMs: 0,
    };
    return {
      id: document.path,
      title: document.title || document.path,
      origin: document.origin === 'transcript' ? 'transcript' : document.origin === 'research' ? 'research' : document.origin === 'url' ? 'web' : 'document',
      sourceUrl: document.sourceUrl,
      updatedAt: document.updatedAt,
      chunks: chunkContent(result),
    };
  }
}

/** Text-format conversion that never silently drops content. */
export function convertText(content: string, format: string): string {
  switch (format) {
    case 'txt':
    case 'md':
      return content;
    case 'json':
      return JSON.stringify({ content }, null, 2);
    case 'html': {
      const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<!doctype html><html><head><meta charset="utf-8"><title>Document</title></head><body><pre>${escaped}</pre></body></html>`;
    }
    case 'csv': {
      const rows = content.split(/\r?\n/).map((line) => [line]);
      return rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    }
    default:
      throw new DocumentPathError(`Conversion to .${format} is not supported.`);
  }
}
