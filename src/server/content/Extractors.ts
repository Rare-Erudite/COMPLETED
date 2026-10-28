/**
 * Extractors — the adapter registry behind the Universal Content Engine.
 *
 * Each extractor declares which content kind it handles, what method it uses,
 * whether it is actually available in this runtime, and how to run. The engine
 * tries them in order and falls back on failure, so adding a format means
 * registering an adapter here — not editing the Documents or Research code.
 */

import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import AdmZip from 'adm-zip';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { ContentKind } from './ContentSniffer.js';

const execFileAsync = promisify(execFile);

export interface ExtractedPage {
  /** 1-based page number where the format has pages. */
  page: number;
  text: string;
}

export interface ExtractionResult {
  text: string;
  /** Identifier of the adapter that produced this text. */
  method: string;
  /** True when the text came from OCR/vision rather than embedded text. */
  ocr: boolean;
  warnings: string[];
  metadata: Record<string, unknown>;
  pages?: ExtractedPage[];
  tables?: Array<{ name: string; rows: string[][] }>;
  /** True when the source was larger than the extraction budget. */
  truncated: boolean;
}

export interface ExtractorInput {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  /** Hard cap on characters returned. */
  maxChars: number;
}

export interface Extractor {
  id: string;
  kind: ContentKind;
  /** Human-readable description of the technique. */
  method: string;
  /** True when this adapter derives text from pixels/audio rather than embedded text. */
  ocr?: boolean;
  /** Whether this adapter can run in the current runtime. */
  available(): Promise<boolean>;
  run(input: ExtractorInput): Promise<ExtractionResult>;
}

const DEFAULT_MAX_CHARS = 400_000;

function clampText(text: string, maxChars: number): { text: string; truncated: boolean } {
  const normalized = text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  if (normalized.length <= maxChars) return { text: normalized, truncated: false };
  return { text: normalized.slice(0, maxChars), truncated: true };
}

async function withTempFile<T>(extension: string, buffer: Buffer, fn: (filePath: string) => Promise<T>): Promise<T> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rare-extract-'));
  const filePath = path.join(directory, `input${extension}`);
  try {
    await fs.writeFile(filePath, buffer);
    return await fn(filePath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function commandExists(command: string): Promise<boolean> {
  // Not every tool supports --version (pdftoppm uses -v), so probe the binary
  // on PATH first and only then fall back to a version call.
  try {
    const { stdout } = await execFileAsync('sh', ['-c', `command -v ${JSON.stringify(command)}`], { timeout: 5000 });
    if (stdout.trim()) return true;
  } catch {
    /* fall through */
  }
  for (const flag of ['--version', '-v', '-version']) {
    try {
      await execFileAsync(command, [flag], { timeout: 5000 });
      return true;
    } catch {
      /* try the next flag */
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Plain text family
// ---------------------------------------------------------------------------

function decodeText(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8');
  // A high ratio of replacement characters means this was not UTF-8.
  const replacements = (utf8.match(/\uFFFD/g) || []).length;
  if (replacements > 0 && replacements / Math.max(1, utf8.length) > 0.01) {
    return buffer.toString('latin1');
  }
  return utf8.replace(/^\uFEFF/, '');
}

const plainTextExtractor: Extractor = {
  id: 'text-utf8',
  kind: 'text',
  method: 'UTF-8/Latin-1 decode',
  available: async () => true,
  run: async ({ buffer, maxChars }) => {
    const { text, truncated } = clampText(decodeText(buffer), maxChars);
    return { text, method: 'text-utf8', ocr: false, warnings: [], metadata: { encoding: 'utf-8' }, truncated };
  },
};

const markdownExtractor: Extractor = {
  id: 'markdown-text',
  kind: 'markdown',
  method: 'Markdown source read (structure preserved)',
  available: async () => true,
  run: async ({ buffer, maxChars }) => {
    const raw = decodeText(buffer);
    const headings = raw.split(/\r?\n/).filter((line) => /^#{1,6}\s+/.test(line)).map((line) => line.replace(/^#{1,6}\s+/, '').trim());
    const { text, truncated } = clampText(raw, maxChars);
    return { text, method: 'markdown-text', ocr: false, warnings: [], metadata: { headings }, truncated };
  },
};

const codeExtractor: Extractor = {
  id: 'code-text',
  kind: 'code',
  method: 'Source text read verbatim',
  available: async () => true,
  run: async ({ buffer, maxChars }) => {
    const { text, truncated } = clampText(decodeText(buffer), maxChars);
    return { text, method: 'code-text', ocr: false, warnings: [], metadata: {}, truncated };
  },
};

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function htmlToText(html: string): { text: string; title: string; headings: string[]; links: string[] } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : '';
  const headings: string[] = [];
  for (const match of html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const value = decodeEntities(match[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (value) headings.push(value);
  }
  const links: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) links.push(match[1]);

  const body = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ');

  const text = decodeEntities(body)
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter((line, index, all) => line.length > 0 || (index > 0 && all[index - 1].length > 0))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, title, headings, links };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

const htmlExtractor: Extractor = {
  id: 'html-dom',
  kind: 'html',
  method: 'HTML text extraction (scripts/styles/nav removed)',
  available: async () => true,
  run: async ({ buffer, maxChars }) => {
    const html = decodeText(buffer);
    const { text, title, headings, links } = htmlToText(html);
    const { text: clamped, truncated } = clampText(text, maxChars);
    const warnings: string[] = [];
    if (clamped.length < 400) {
      warnings.push('Very little readable text was found in the HTML — the page may be JavaScript-rendered or mostly media.');
    }
    return {
      text: clamped,
      method: 'html-dom',
      ocr: false,
      warnings,
      metadata: { title, headings: headings.slice(0, 200), linkCount: links.length, links: links.slice(0, 200) },
      truncated,
    };
  },
};

// ---------------------------------------------------------------------------
// Structured data
// ---------------------------------------------------------------------------

const jsonExtractor: Extractor = {
  id: 'json-parse',
  kind: 'json',
  method: 'JSON parse + flattened key/value rendering',
  available: async () => true,
  run: async ({ buffer, maxChars }) => {
    const raw = decodeText(buffer);
    const warnings: string[] = [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // JSONL / NDJSON
      const lines = raw.split(/\r?\n/).filter((line) => line.trim());
      const records: unknown[] = [];
      for (const line of lines) {
        try {
          records.push(JSON.parse(line));
        } catch {
          warnings.push('Some lines were not valid JSON and were skipped.');
        }
      }
      if (records.length === 0) throw new Error('The payload is not valid JSON or JSONL.');
      parsed = records;
    }
    const { text, truncated } = clampText(JSON.stringify(parsed, null, 2), maxChars);
    return { text, method: 'json-parse', ocr: false, warnings, metadata: { topLevelType: Array.isArray(parsed) ? 'array' : typeof parsed }, truncated };
  },
};

const yamlExtractor: Extractor = {
  id: 'yaml-parse',
  kind: 'yaml',
  method: 'YAML parse + normalised rendering',
  available: async () => true,
  run: async ({ buffer, maxChars }) => {
    const raw = decodeText(buffer);
    const warnings: string[] = [];
    let rendered = raw;
    try {
      const YAML = await import('yaml');
      const parsed = YAML.parse(raw);
      rendered = JSON.stringify(parsed, null, 2);
    } catch (error) {
      warnings.push(`YAML could not be parsed (${error instanceof Error ? error.message : 'unknown error'}); returning the raw source.`);
    }
    const { text, truncated } = clampText(rendered, maxChars);
    return { text, method: 'yaml-parse', ocr: false, warnings, metadata: {}, truncated };
  },
};

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"' && field.length === 0) quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
}

function renderTable(rows: string[][], name: string): string {
  if (rows.length === 0) return `[${name}] (empty)`;
  const header = rows[0];
  const body = rows.slice(1);
  const lines = [`## ${name}`, '', `| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
  for (const row of body) lines.push(`| ${header.map((_cell, index) => (row[index] ?? '').replace(/\|/g, '\\|')).join(' | ')} |`);
  return lines.join('\n');
}

const csvExtractor: Extractor = {
  id: 'csv-parse',
  kind: 'csv',
  method: 'RFC4180 CSV parse + Markdown table rendering',
  available: async () => true,
  run: async ({ buffer, maxChars }) => {
    const rows = parseDelimited(decodeText(buffer), ',');
    const { text, truncated } = clampText(renderTable(rows, 'CSV'), maxChars);
    return { text, method: 'csv-parse', ocr: false, warnings: [], metadata: { rowCount: Math.max(0, rows.length - 1), columnCount: rows[0]?.length ?? 0 }, tables: [{ name: 'CSV', rows }], truncated };
  },
};

const tsvExtractor: Extractor = {
  id: 'tsv-parse',
  kind: 'tsv',
  method: 'TSV parse + Markdown table rendering',
  available: async () => true,
  run: async ({ buffer, maxChars }) => {
    const rows = parseDelimited(decodeText(buffer), '\t');
    const { text, truncated } = clampText(renderTable(rows, 'TSV'), maxChars);
    return { text, method: 'tsv-parse', ocr: false, warnings: [], metadata: { rowCount: Math.max(0, rows.length - 1) }, tables: [{ name: 'TSV', rows }], truncated };
  },
};

const xmlExtractor: Extractor = {
  id: 'xml-text',
  kind: 'xml',
  method: 'XML text-node extraction',
  available: async () => true,
  run: async ({ buffer, maxChars }) => {
    const raw = decodeText(buffer);
    const text = decodeEntities(
      raw
        .replace(/<\?[\s\S]*?\?>/g, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]+>/g, '\n'),
    );
    const { text: clamped, truncated } = clampText(text, maxChars);
    return { text: clamped, method: 'xml-text', ocr: false, warnings: [], metadata: {}, truncated };
  },
};

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

async function pdfTextViaPdfJs(buffer: Buffer): Promise<{ text: string; pages: ExtractedPage[]; pageCount: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs' as any);
  const document = await (pdfjs as any).getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise;
  const pages: ExtractedPage[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: any) => (typeof item.str === 'string' ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    pages.push({ page: pageNumber, text });
  }
  await document.destroy();
  return { text: pages.map((page) => page.text).join('\n\n'), pages, pageCount: document.numPages };
}

async function pdfTextViaPoppler(buffer: Buffer): Promise<{ text: string; pages: ExtractedPage[] }> {
  return withTempFile('.pdf', buffer, async (filePath) => {
    const { stdout } = await execFileAsync('pdftotext', ['-layout', '-enc', 'UTF-8', filePath, '-'], {
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const pages = stdout.split('\f').map((text, index) => ({ page: index + 1, text: text.trim() }));
    return { text: pages.map((page) => page.text).join('\n\n'), pages };
  });
}

async function pdfOcrViaPopplerAndTesseract(buffer: Buffer, maxPages: number): Promise<{ text: string; pages: ExtractedPage[]; warnings: string[] }> {
  return withTempFile('.pdf', buffer, async (filePath) => {
    const directory = path.dirname(filePath);
    const prefix = path.join(directory, 'page');
    await execFileAsync('pdftoppm', ['-r', '200', '-png', '-f', '1', '-l', String(maxPages), filePath, prefix], {
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const files = (await fs.readdir(directory)).filter((name) => name.startsWith('page') && name.endsWith('.png')).sort();
    const pages: ExtractedPage[] = [];
    const warnings: string[] = [];
    for (const [index, name] of files.entries()) {
      try {
        const { stdout } = await execFileAsync('tesseract', [path.join(directory, name), 'stdout', '-l', 'eng', '--psm', '3'], {
          timeout: 120_000,
          maxBuffer: 32 * 1024 * 1024,
        });
        pages.push({ page: index + 1, text: stdout.trim() });
      } catch (error) {
        warnings.push(`OCR failed on page ${index + 1}: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
    if (files.length === 0) warnings.push('No pages could be rasterised for OCR.');
    return { text: pages.map((page) => page.text).join('\n\n'), pages, warnings };
  });
}

const pdfExtractor: Extractor = {
  id: 'pdf-text',
  kind: 'pdf',
  method: 'Embedded PDF text layer (pdf.js, poppler fallback)',
  available: async () => true,
  run: async ({ buffer, maxChars }) => {
    const warnings: string[] = [];
    let pages: ExtractedPage[] = [];
    let method = 'pdfjs-text';
    try {
      const result = await pdfTextViaPdfJs(buffer);
      pages = result.pages;
    } catch (error) {
      warnings.push(`pdf.js could not read the file (${error instanceof Error ? error.message : 'unknown error'}); trying poppler.`);
      try {
        const result = await pdfTextViaPoppler(buffer);
        pages = result.pages;
        method = 'poppler-pdftotext';
      } catch (popplerError) {
        warnings.push(`poppler could not read the file (${popplerError instanceof Error ? popplerError.message : 'unknown error'}).`);
      }
    }
    const embedded = pages.map((page) => page.text).join('\n').trim();
    const { text, truncated } = clampText(embedded, maxChars);
    return {
      text,
      method,
      ocr: false,
      warnings,
      metadata: { pageCount: pages.length, textLayerChars: embedded.length },
      pages,
      truncated,
    };
  },
};

const pdfOcrExtractor: Extractor = {
  id: 'pdf-ocr',
  kind: 'pdf',
  method: 'Rasterise pages (pdftoppm) + OCR (tesseract)',
  ocr: true,
  available: async () => (await commandExists('pdftoppm')) && (await commandExists('tesseract')),
  run: async ({ buffer, maxChars }) => {
    const result = await pdfOcrViaPopplerAndTesseract(buffer, 40);
    const { text, truncated } = clampText(result.text, maxChars);
    return {
      text,
      method: 'pdf-ocr',
      ocr: true,
      warnings: result.warnings,
      metadata: { pageCount: result.pages.length, ocrPages: result.pages.length },
      pages: result.pages,
      truncated,
    };
  },
};

// ---------------------------------------------------------------------------
// Office / ODF / EPUB
// ---------------------------------------------------------------------------

const docxExtractor: Extractor = {
  id: 'docx-mammoth',
  kind: 'docx',
  method: 'DOCX body text via mammoth',
  available: async () => true,
  run: async ({ buffer, maxChars }) => {
    const result = await mammoth.extractRawText({ buffer });
    const warnings = result.messages.filter((message) => message.type === 'warning').map((message) => message.message).slice(0, 20);
    const { text, truncated } = clampText(result.value, maxChars);
    return { text, method: 'docx-mammoth', ocr: false, warnings, metadata: { messageCount: result.messages.length }, truncated };
  },
};

const odtExtractor: Extractor = {
  id: 'odt-content-xml',
  kind: 'odt',
  method: 'ODF content.xml text extraction',
  available: async () => true,
  run: async ({ buffer, maxChars }) => {
    const zip = new AdmZip(buffer);
    const entry = zip.getEntry('content.xml');
    if (!entry) throw new Error('The ODT file has no content.xml.');
    const xml = zip.readAsText(entry);
    const text = decodeEntities(
      xml
        .replace(/<text:line-break\s*\/>/g, '\n')
        .replace(/<\/text:p>/g, '\n')
        .replace(/<\/text:h>/g, '\n')
        .replace(/<[^>]+>/g, ''),
    );
    const { text: clamped, truncated } = clampText(text, maxChars);
    return { text: clamped, method: 'odt-content-xml', ocr: false, warnings: [], metadata: {}, truncated };
  },
};

const rtfExtractor: Extractor = {
  id: 'rtf-text',
  kind: 'rtf',
  method: 'RTF control-word stripping',
  available: async () => true,
  run: async ({ buffer, maxChars }) => {
    const raw = decodeText(buffer);
    const text = raw
      .replace(/\\'([0-9a-f]{2})/gi, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
      .replace(/\\u(-?\d+)\??/g, (_match, code) => String.fromCharCode(((Number(code) % 65536) + 65536) % 65536))
      .replace(/\\par[d]?\b/g, '\n')
      .replace(/\\line\b/g, '\n')
      .replace(/\\tab\b/g, '\t')
      .replace(/\{\\\*[^{}]*\}/g, '')
      .replace(/\\[a-z]+-?\d*\s?/gi, '')
      .replace(/[{}]/g, '');
    const { text: clamped, truncated } = clampText(text, maxChars);
    return { text: clamped, method: 'rtf-text', ocr: false, warnings: ['RTF formatting is not preserved; only text is extracted.'], metadata: {}, truncated };
  },
};

const spreadsheetExtractor: Extractor = {
  id: 'spreadsheet-sheetjs',
  kind: 'xlsx',
  method: 'Workbook parse via SheetJS (all sheets, formulas as values)',
  available: async () => true,
  run: async ({ buffer, maxChars }) => {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellFormula: true });
    const tables: Array<{ name: string; rows: string[][] }> = [];
    const sections: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' }) as string[][];
      tables.push({ name: sheetName, rows });
      sections.push(renderTable(rows, sheetName));
    }
    const { text, truncated } = clampText(sections.join('\n\n'), maxChars);
    return {
      text,
      method: 'spreadsheet-sheetjs',
      ocr: false,
      warnings: [],
      metadata: { sheetCount: workbook.SheetNames.length, sheetNames: workbook.SheetNames },
      tables,
      truncated,
    };
  },
};

const pptxExtractor: Extractor = {
  id: 'pptx-slide-xml',
  kind: 'pptx',
  method: 'PPTX slide XML text + speaker notes',
  available: async () => true,
  run: async ({ buffer, maxChars }) => {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    const slideEntries = entries
      .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.entryName))
      .sort((left, right) => {
        const leftNumber = Number(left.entryName.match(/slide(\d+)\.xml$/)?.[1] || 0);
        const rightNumber = Number(right.entryName.match(/slide(\d+)\.xml$/)?.[1] || 0);
        return leftNumber - rightNumber;
      });
    if (slideEntries.length === 0) throw new Error('The presentation contains no slides.');
    const pages: ExtractedPage[] = [];
    for (const [index, entry] of slideEntries.entries()) {
      const xml = zip.readAsText(entry);
      const runs = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => decodeEntities(match[1]));
      const notesEntry = zip.getEntry(`ppt/notesSlides/notesSlide${index + 1}.xml`);
      const notes = notesEntry
        ? [...zip.readAsText(notesEntry).matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => decodeEntities(match[1])).join(' ')
        : '';
      const body = runs.join('\n').trim();
      pages.push({ page: index + 1, text: notes ? `${body}\n\n[Speaker notes] ${notes}` : body });
    }
    const { text, truncated } = clampText(pages.map((page) => `## Slide ${page.page}\n${page.text}`).join('\n\n'), maxChars);
    return { text, method: 'pptx-slide-xml', ocr: false, warnings: [], metadata: { slideCount: pages.length }, pages, truncated };
  },
};

const epubExtractor: Extractor = {
  id: 'epub-spine',
  kind: 'epub',
  method: 'EPUB spine traversal (chapter order preserved)',
  available: async () => true,
  run: async ({ buffer, maxChars }) => {
    const zip = new AdmZip(buffer);
    const containerEntry = zip.getEntry('META-INF/container.xml');
    if (!containerEntry) throw new Error('The EPUB has no META-INF/container.xml.');
    const containerXml = zip.readAsText(containerEntry);
    const opfPath = containerXml.match(/full-path=["']([^"']+)["']/i)?.[1];
    if (!opfPath) throw new Error('The EPUB container does not name a package document.');
    const opfEntry = zip.getEntry(opfPath);
    if (!opfEntry) throw new Error('The EPUB package document is missing.');
    const opf = zip.readAsText(opfEntry);
    const baseDirectory = path.posix.dirname(opfPath);
    const manifest = new Map<string, string>();
    for (const match of opf.matchAll(/<item\b[^>]*id=["']([^"']+)["'][^>]*href=["']([^"']+)["'][^>]*\/?>/gi)) {
      manifest.set(match[1], match[2]);
    }
    for (const match of opf.matchAll(/<item\b[^>]*href=["']([^"']+)["'][^>]*id=["']([^"']+)["'][^>]*\/?>/gi)) {
      if (!manifest.has(match[2])) manifest.set(match[2], match[1]);
    }
    const spineIds = [...opf.matchAll(/<itemref\b[^>]*idref=["']([^"']+)["']/gi)].map((match) => match[1]);
    const title = opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1]?.trim() || '';
    const pages: ExtractedPage[] = [];
    const warnings: string[] = [];
    for (const [index, id] of spineIds.entries()) {
      const href = manifest.get(id);
      if (!href) continue;
      const entryPath = path.posix.normalize(path.posix.join(baseDirectory, decodeURIComponent(href)));
      const entry = zip.getEntry(entryPath);
      if (!entry) {
        warnings.push(`Chapter ${index + 1} (${href}) was missing from the archive.`);
        continue;
      }
      const { text } = htmlToText(zip.readAsText(entry));
      pages.push({ page: index + 1, text });
    }
    const { text, truncated } = clampText(pages.map((page) => page.text).join('\n\n'), maxChars);
    return { text, method: 'epub-spine', ocr: false, warnings, metadata: { title, chapterCount: pages.length }, pages, truncated };
  },
};

// ---------------------------------------------------------------------------
// Archives — controlled listing, no extraction to disk
// ---------------------------------------------------------------------------

const ARCHIVE_ENTRY_LIMIT = 500;

const zipExtractor: Extractor = {
  id: 'zip-listing',
  kind: 'zip',
  method: 'Archive entry listing (no extraction)',
  available: async () => true,
  run: async ({ buffer, maxChars }) => {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    const warnings: string[] = [];
    if (entries.length > ARCHIVE_ENTRY_LIMIT) warnings.push(`Archive has ${entries.length} entries; only the first ${ARCHIVE_ENTRY_LIMIT} are listed.`);
    const lines = entries.slice(0, ARCHIVE_ENTRY_LIMIT).map((entry) => {
      const unsafe = entry.entryName.includes('..') || entry.entryName.startsWith('/');
      return `${unsafe ? '[unsafe path] ' : ''}${entry.entryName}\t${entry.header.size} bytes`;
    });
    const { text, truncated } = clampText(`## Archive contents (${entries.length} entries)\n\n${lines.join('\n')}`, maxChars);
    return { text, method: 'zip-listing', ocr: false, warnings, metadata: { entryCount: entries.length }, truncated };
  },
};

const gzipExtractor: Extractor = {
  id: 'gzip-inflate',
  kind: 'gzip',
  method: 'GZIP inflate (bounded)',
  available: async () => true,
  run: async ({ buffer, maxChars }) => {
    const zlib = await import('zlib');
    const inflated = zlib.gunzipSync(buffer, { maxOutputLength: 32 * 1024 * 1024 });
    const { text, truncated } = clampText(decodeText(inflated), maxChars);
    return { text, method: 'gzip-inflate', ocr: false, warnings: [], metadata: { inflatedBytes: inflated.length }, truncated };
  },
};

// ---------------------------------------------------------------------------
// Images — OCR
// ---------------------------------------------------------------------------

const imageOcrExtractor: Extractor = {
  id: 'image-tesseract',
  kind: 'png',
  method: 'OCR via tesseract',
  ocr: true,
  available: async () => commandExists('tesseract'),
  run: async ({ buffer, filename, maxChars }) => {
    const extension = path.extname(filename) || '.png';
    return withTempFile(extension, buffer, async (filePath) => {
      const { stdout } = await execFileAsync('tesseract', [filePath, 'stdout', '-l', 'eng', '--psm', '3'], {
        timeout: 120_000,
        maxBuffer: 32 * 1024 * 1024,
      });
      const { text, truncated } = clampText(stdout, maxChars);
      const warnings: string[] = [];
      if (text.trim().length === 0) warnings.push('OCR found no readable text in this image.');
      return { text, method: 'image-tesseract', ocr: true, warnings, metadata: { engine: 'tesseract 5' }, truncated };
    });
  },
};

// ---------------------------------------------------------------------------
// Email / subtitles
// ---------------------------------------------------------------------------

const emlExtractor: Extractor = {
  id: 'eml-rfc822',
  kind: 'eml',
  method: 'RFC822 header + body extraction',
  available: async () => true,
  run: async ({ buffer, maxChars }) => {
    const raw = decodeText(buffer);
    const separator = raw.search(/\r?\n\r?\n/);
    const headerBlock = separator === -1 ? raw : raw.slice(0, separator);
    const body = separator === -1 ? '' : raw.slice(separator).trim();
    const headers: Record<string, string> = {};
    for (const line of headerBlock.split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z-]+):\s*(.*)$/);
      if (match) headers[match[1].toLowerCase()] = match[2];
    }
    const bodyText = /<html/i.test(body) ? htmlToText(body).text : body;
    const rendered = [
      headers.from ? `From: ${headers.from}` : '',
      headers.to ? `To: ${headers.to}` : '',
      headers.date ? `Date: ${headers.date}` : '',
      headers.subject ? `Subject: ${headers.subject}` : '',
      '',
      bodyText,
    ].filter((line, index) => line !== '' || index === 4).join('\n');
    const { text, truncated } = clampText(rendered, maxChars);
    return { text, method: 'eml-rfc822', ocr: false, warnings: [], metadata: { subject: headers.subject || '', from: headers.from || '', date: headers.date || '' }, truncated };
  },
};

const subtitleExtractor: Extractor = {
  id: 'subtitle-cues',
  kind: 'srt',
  method: 'Subtitle cue parse (timestamps preserved)',
  available: async () => true,
  run: async ({ buffer, maxChars }) => {
    const raw = decodeText(buffer);
    const cues: Array<{ start: string; end: string; text: string }> = [];
    const blocks = raw.split(/\r?\n\r?\n/);
    for (const block of blocks) {
      const lines = block.split(/\r?\n/).filter((line) => line.trim().length > 0);
      const timeLineIndex = lines.findIndex((line) => line.includes('-->'));
      if (timeLineIndex === -1) continue;
      const [start, end] = lines[timeLineIndex].split('-->').map((value) => value.trim().split(' ')[0]);
      cues.push({ start, end, text: lines.slice(timeLineIndex + 1).join(' ').replace(/<[^>]+>/g, '') });
    }
    const rendered = cues.map((cue) => `[${cue.start} → ${cue.end}] ${cue.text}`).join('\n');
    const { text, truncated } = clampText(rendered, maxChars);
    return { text, method: 'subtitle-cues', ocr: false, warnings: [], metadata: { cueCount: cues.length }, truncated };
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const REGISTRY: Extractor[] = [
  plainTextExtractor,
  markdownExtractor,
  codeExtractor,
  htmlExtractor,
  jsonExtractor,
  yamlExtractor,
  csvExtractor,
  tsvExtractor,
  xmlExtractor,
  pdfExtractor,
  pdfOcrExtractor,
  docxExtractor,
  odtExtractor,
  rtfExtractor,
  spreadsheetExtractor,
  pptxExtractor,
  epubExtractor,
  zipExtractor,
  gzipExtractor,
  imageOcrExtractor,
  emlExtractor,
  subtitleExtractor,
];

/** Kinds that share an adapter family (e.g. all raster images use OCR). */
const KIND_ALIASES: Partial<Record<ContentKind, ContentKind[]>> = {
  xlsx: ['xlsx', 'xls', 'ods'],
  pptx: ['pptx', 'ppt', 'odp'],
  docx: ['docx', 'doc', 'odt'],
  png: ['png', 'jpeg', 'gif', 'webp', 'tiff', 'bmp'],
  srt: ['srt', 'vtt'],
  text: ['text', 'code', 'markdown'],
};

export function extractorsFor(kind: ContentKind): Extractor[] {
  const kinds = KIND_ALIASES[kind] || [kind];
  return REGISTRY.filter((extractor) => kinds.includes(extractor.kind));
}

export function listExtractors(): Array<{ id: string; kind: ContentKind; method: string }> {
  return REGISTRY.map(({ id, kind, method }) => ({ id, kind, method }));
}

/**
 * Probe every adapter for real availability in this runtime.
 *
 * `listExtractors` only describes what the registry contains; this reports what
 * can actually run here, so callers never advertise a format whose dependency
 * (poppler, tesseract, LibreOffice) is missing from the deployment.
 */
export async function probeExtractors(): Promise<
  Array<{ id: string; kind: ContentKind; method: string; ocr: boolean; available: boolean; note?: string }>
> {
  return Promise.all(
    REGISTRY.map(async (extractor) => {
      let available = false;
      let note: string | undefined;
      try {
        available = await extractor.available();
        if (!available) note = 'Runtime dependency missing in this deployment.';
      } catch (error) {
        note = error instanceof Error ? error.message : 'Availability probe failed.';
      }
      return {
        id: extractor.id,
        kind: extractor.kind,
        method: extractor.method,
        ocr: Boolean(extractor.ocr),
        available,
        ...(note ? { note } : {}),
      };
    }),
  );
}

export { DEFAULT_MAX_CHARS, htmlToText, decodeText, clampText };
