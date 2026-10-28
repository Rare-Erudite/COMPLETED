/**
 * ContentSniffer — identify what a payload actually IS, from its bytes.
 *
 * Filenames and Content-Type headers lie. Everything here reads the leading
 * bytes (and, for container formats, the archive entry names) and returns a
 * canonical content kind. The capability registry then decides how to process
 * that kind, so an unfamiliar extension is routed by real content rather than
 * rejected.
 */

export type ContentKind =
  | 'pdf'
  | 'docx'
  | 'doc'
  | 'xlsx'
  | 'xls'
  | 'ods'
  | 'pptx'
  | 'ppt'
  | 'odp'
  | 'odt'
  | 'rtf'
  | 'epub'
  | 'zip'
  | 'gzip'
  | 'tar'
  | '7z'
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'webp'
  | 'tiff'
  | 'bmp'
  | 'svg'
  | 'mp3'
  | 'wav'
  | 'ogg'
  | 'flac'
  | 'm4a'
  | 'aac'
  | 'webm'
  | 'mp4'
  | 'mov'
  | 'avi'
  | 'mkv'
  | 'html'
  | 'xml'
  | 'json'
  | 'yaml'
  | 'csv'
  | 'tsv'
  | 'eml'
  | 'mbox'
  | 'srt'
  | 'vtt'
  | 'markdown'
  | 'code'
  | 'text'
  | 'unknown';

export interface SniffResult {
  kind: ContentKind;
  /** Human-readable label for the UI. */
  label: string;
  /** Broad family used to pick a processing strategy. */
  family: 'document' | 'spreadsheet' | 'presentation' | 'image' | 'audio' | 'video' | 'archive' | 'text' | 'email' | 'subtitle' | 'unknown';
  /** MIME type we believe this is. */
  mimeType: string;
  /** How the decision was reached — useful for provenance. */
  evidence: string;
  /** True when the bytes are textual (safe to decode as UTF-8). */
  textual: boolean;
}

const LABELS: Record<ContentKind, { label: string; family: SniffResult['family']; mimeType: string }> = {
  pdf: { label: 'PDF document', family: 'document', mimeType: 'application/pdf' },
  docx: { label: 'Word document (DOCX)', family: 'document', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  doc: { label: 'Word document (legacy DOC)', family: 'document', mimeType: 'application/msword' },
  xlsx: { label: 'Excel workbook (XLSX)', family: 'spreadsheet', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  xls: { label: 'Excel workbook (legacy XLS)', family: 'spreadsheet', mimeType: 'application/vnd.ms-excel' },
  ods: { label: 'OpenDocument spreadsheet', family: 'spreadsheet', mimeType: 'application/vnd.oasis.opendocument.spreadsheet' },
  pptx: { label: 'PowerPoint deck (PPTX)', family: 'presentation', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  ppt: { label: 'PowerPoint deck (legacy PPT)', family: 'presentation', mimeType: 'application/vnd.ms-powerpoint' },
  odp: { label: 'OpenDocument presentation', family: 'presentation', mimeType: 'application/vnd.oasis.opendocument.presentation' },
  odt: { label: 'OpenDocument text', family: 'document', mimeType: 'application/vnd.oasis.opendocument.text' },
  rtf: { label: 'Rich Text Format', family: 'document', mimeType: 'application/rtf' },
  epub: { label: 'EPUB book', family: 'document', mimeType: 'application/epub+zip' },
  zip: { label: 'ZIP archive', family: 'archive', mimeType: 'application/zip' },
  gzip: { label: 'GZIP archive', family: 'archive', mimeType: 'application/gzip' },
  tar: { label: 'TAR archive', family: 'archive', mimeType: 'application/x-tar' },
  '7z': { label: '7-Zip archive', family: 'archive', mimeType: 'application/x-7z-compressed' },
  png: { label: 'PNG image', family: 'image', mimeType: 'image/png' },
  jpeg: { label: 'JPEG image', family: 'image', mimeType: 'image/jpeg' },
  gif: { label: 'GIF image', family: 'image', mimeType: 'image/gif' },
  webp: { label: 'WebP image', family: 'image', mimeType: 'image/webp' },
  tiff: { label: 'TIFF image', family: 'image', mimeType: 'image/tiff' },
  bmp: { label: 'BMP image', family: 'image', mimeType: 'image/bmp' },
  svg: { label: 'SVG image', family: 'image', mimeType: 'image/svg+xml' },
  mp3: { label: 'MP3 audio', family: 'audio', mimeType: 'audio/mpeg' },
  wav: { label: 'WAV audio', family: 'audio', mimeType: 'audio/wav' },
  ogg: { label: 'OGG audio', family: 'audio', mimeType: 'audio/ogg' },
  flac: { label: 'FLAC audio', family: 'audio', mimeType: 'audio/flac' },
  m4a: { label: 'M4A audio', family: 'audio', mimeType: 'audio/mp4' },
  aac: { label: 'AAC audio', family: 'audio', mimeType: 'audio/aac' },
  webm: { label: 'WebM media', family: 'video', mimeType: 'video/webm' },
  mp4: { label: 'MP4 media', family: 'video', mimeType: 'video/mp4' },
  mov: { label: 'QuickTime media', family: 'video', mimeType: 'video/quicktime' },
  avi: { label: 'AVI media', family: 'video', mimeType: 'video/x-msvideo' },
  mkv: { label: 'Matroska media', family: 'video', mimeType: 'video/x-matroska' },
  html: { label: 'HTML page', family: 'text', mimeType: 'text/html' },
  xml: { label: 'XML document', family: 'text', mimeType: 'application/xml' },
  json: { label: 'JSON data', family: 'text', mimeType: 'application/json' },
  yaml: { label: 'YAML data', family: 'text', mimeType: 'application/yaml' },
  csv: { label: 'CSV table', family: 'text', mimeType: 'text/csv' },
  tsv: { label: 'TSV table', family: 'text', mimeType: 'text/tab-separated-values' },
  eml: { label: 'Email message', family: 'email', mimeType: 'message/rfc822' },
  mbox: { label: 'Mailbox archive', family: 'email', mimeType: 'application/mbox' },
  srt: { label: 'SubRip subtitles', family: 'subtitle', mimeType: 'application/x-subrip' },
  vtt: { label: 'WebVTT subtitles', family: 'subtitle', mimeType: 'text/vtt' },
  markdown: { label: 'Markdown document', family: 'text', mimeType: 'text/markdown' },
  code: { label: 'Source code / config', family: 'text', mimeType: 'text/plain' },
  text: { label: 'Plain text', family: 'text', mimeType: 'text/plain' },
  unknown: { label: 'Unrecognised content', family: 'unknown', mimeType: 'application/octet-stream' },
};

const TEXTUAL_KINDS = new Set<ContentKind>([
  'html', 'xml', 'json', 'yaml', 'csv', 'tsv', 'eml', 'mbox', 'srt', 'vtt', 'markdown', 'code', 'text', 'svg', 'rtf',
]);

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs',
  'php', 'swift', 'scala', 'sh', 'bash', 'zsh', 'ps1', 'sql', 'toml', 'ini', 'cfg', 'conf', 'env', 'dockerfile',
  'makefile', 'gradle', 'properties', 'lock', 'diff', 'patch',
]);

function startsWith(buffer: Buffer, bytes: number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

function asciiAt(buffer: Buffer, offset: number, length: number): string {
  return buffer.subarray(offset, offset + length).toString('latin1');
}

/** Detect a ZIP-based OOXML/ODF/EPUB container by inspecting entry names. */
function sniffZipContainer(buffer: Buffer): { kind: ContentKind; evidence: string } | null {
  // Central directory entry names are stored as plain ASCII in the archive.
  const haystack = buffer.subarray(0, Math.min(buffer.length, 512 * 1024)).toString('latin1');
  if (haystack.includes('word/document.xml')) return { kind: 'docx', evidence: 'zip container with word/document.xml' };
  if (haystack.includes('xl/workbook.xml')) return { kind: 'xlsx', evidence: 'zip container with xl/workbook.xml' };
  // Some producers omit presentation.xml from the first 512 KB; slide parts are
  // equally conclusive, so accept either.
  if (haystack.includes('ppt/presentation.xml') || haystack.includes('ppt/slides/slide')) {
    return { kind: 'pptx', evidence: 'zip container with PowerPoint slide parts' };
  }
  if (haystack.includes('mimetypeapplication/epub+zip') || haystack.includes('META-INF/container.xml')) {
    return { kind: 'epub', evidence: 'zip container with EPUB mimetype/container.xml' };
  }
  if (haystack.includes('mimetypeapplication/vnd.oasis.opendocument.text')) return { kind: 'odt', evidence: 'ODF text mimetype' };
  if (haystack.includes('mimetypeapplication/vnd.oasis.opendocument.spreadsheet')) return { kind: 'ods', evidence: 'ODF spreadsheet mimetype' };
  if (haystack.includes('mimetypeapplication/vnd.oasis.opendocument.presentation')) return { kind: 'odp', evidence: 'ODF presentation mimetype' };
  return null;
}

function looksLikeText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.length === 0) return true;
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    // Allow tab, LF, CR, form feed and printable ASCII / high-bit UTF-8 bytes.
    if (byte < 9 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / sample.length < 0.02;
}

function sniffTextual(buffer: Buffer, filenameHint: string): SniffResult {
  const head = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8').replace(/^\uFEFF/, '');
  const trimmed = head.trimStart();
  const lower = trimmed.toLowerCase();
  const extension = filenameHint.includes('.') ? filenameHint.split('.').pop()!.toLowerCase() : '';

  if (lower.startsWith('<!doctype html') || lower.startsWith('<html') || /<head[\s>]|<body[\s>]/i.test(head)) {
    return build('html', 'markup signature in leading bytes');
  }
  if (lower.startsWith('<?xml')) {
    if (/<svg[\s>]/i.test(head)) return build('svg', 'XML declaration with <svg> root');
    if (/<rss[\s>]|<feed[\s>]/i.test(head)) return build('xml', 'XML declaration with RSS/Atom root');
    return build('xml', 'XML declaration');
  }
  if (lower.startsWith('{\\rtf')) return build('rtf', 'RTF header');
  if (lower.startsWith('webvtt')) return build('vtt', 'WEBVTT header');
  if (/^\d+\s*\r?\n\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(trimmed)) return build('srt', 'SubRip cue pattern');
  if (/^(from|received|return-path|subject|date|to|cc):/im.test(head) && /^from:/im.test(head)) {
    return build('eml', 'RFC822 header block');
  }
  if (/^from\s+\S+\s+\w{3}\s+\w{3}\s+\d+/m.test(head) && head.includes('\nFrom ')) {
    return build('mbox', 'mbox "From " separator lines');
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(buffer.subarray(0, Math.min(buffer.length, 2 * 1024 * 1024)).toString('utf8'));
      return build('json', 'parses as JSON');
    } catch {
      // Not valid JSON — fall through to other textual checks.
    }
  }
  if (extension === 'jsonl' || extension === 'ndjson') {
    const firstLine = trimmed.split(/\r?\n/, 1)[0];
    try {
      JSON.parse(firstLine);
      return build('json', 'JSONL first line parses as JSON');
    } catch {
      /* ignore */
    }
  }
  if (extension === 'yaml' || extension === 'yml') return build('yaml', 'YAML extension with textual content');
  if (/^---\s*$/m.test(head) && /^[a-z0-9_-]+:\s/m.test(head)) return build('yaml', 'YAML front-matter/document pattern');

  // Delimited tables: consistent delimiter count across the first lines.
  const lines = trimmed.split(/\r?\n/).slice(0, 6).filter((line) => line.length > 0);
  if (lines.length >= 2) {
    for (const [delimiter, kind] of [[',', 'csv'], ['\t', 'tsv']] as Array<[string, ContentKind]>) {
      const counts = lines.map((line) => line.split(delimiter).length);
      if (counts[0] > 1 && counts.every((count) => count === counts[0])) {
        return build(kind, `consistent "${delimiter === '\t' ? '\\t' : delimiter}" delimiters across ${lines.length} lines`);
      }
    }
  }

  if (extension === 'md' || extension === 'markdown' || /^#{1,6}\s+\S/m.test(head) || /^```/m.test(head)) {
    return build('markdown', 'Markdown heading/fence syntax');
  }
  if (CODE_EXTENSIONS.has(extension)) return build('code', `source-code extension .${extension}`);
  if (/^(#!\/|package |import |export |function |class |def |const |let |var |using |namespace )/m.test(head)) {
    return build('code', 'source-code statement pattern');
  }
  return build('text', 'decodable text without a more specific signature');
}

function build(kind: ContentKind, evidence: string): SniffResult {
  const meta = LABELS[kind];
  return {
    kind,
    label: meta.label,
    family: meta.family,
    mimeType: meta.mimeType,
    evidence,
    textual: TEXTUAL_KINDS.has(kind),
  };
}

/**
 * Identify content from its bytes. `filenameHint` is only ever a tie-breaker
 * for genuinely ambiguous textual payloads — never the primary signal.
 */
export function sniffContent(buffer: Buffer, filenameHint = '', declaredMime = ''): SniffResult {
  if (buffer.length === 0) return build('text', 'empty payload');

  // --- Binary magic numbers -------------------------------------------------
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46])) return build('pdf', '%PDF magic bytes');
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buffer, [0x50, 0x4b, 0x05, 0x06])) {
    const container = sniffZipContainer(buffer);
    if (container) return build(container.kind, container.evidence);
    return build('zip', 'PK zip magic bytes');
  }
  if (startsWith(buffer, [0x1f, 0x8b])) return build('gzip', 'gzip magic bytes');
  if (startsWith(buffer, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return build('7z', '7z magic bytes');
  if (asciiAt(buffer, 257, 5) === 'ustar') return build('tar', 'ustar marker at offset 257');
  if (startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    // OLE2 compound file: legacy DOC/XLS/PPT share this container.
    const haystack = buffer.subarray(0, Math.min(buffer.length, 256 * 1024)).toString('latin1');
    if (haystack.includes('WordDocument')) return build('doc', 'OLE2 container with WordDocument stream');
    if (haystack.includes('Workbook') || haystack.includes('Book')) return build('xls', 'OLE2 container with Workbook stream');
    if (haystack.includes('PowerPoint Document')) return build('ppt', 'OLE2 container with PowerPoint stream');
    return build('doc', 'OLE2 compound document');
  }
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47])) return build('png', 'PNG magic bytes');
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return build('jpeg', 'JPEG SOI marker');
  if (startsWith(buffer, [0x47, 0x49, 0x46, 0x38])) return build('gif', 'GIF magic bytes');
  if (asciiAt(buffer, 0, 4) === 'RIFF' && asciiAt(buffer, 8, 4) === 'WEBP') return build('webp', 'RIFF/WEBP header');
  if (asciiAt(buffer, 0, 4) === 'RIFF' && asciiAt(buffer, 8, 4) === 'WAVE') return build('wav', 'RIFF/WAVE header');
  if (asciiAt(buffer, 0, 4) === 'RIFF' && asciiAt(buffer, 8, 4) === 'AVI ') return build('avi', 'RIFF/AVI header');
  if (startsWith(buffer, [0x49, 0x49, 0x2a, 0x00]) || startsWith(buffer, [0x4d, 0x4d, 0x00, 0x2a])) return build('tiff', 'TIFF magic bytes');
  if (asciiAt(buffer, 0, 2) === 'BM') return build('bmp', 'BMP magic bytes');
  if (asciiAt(buffer, 0, 4) === 'fLaC') return build('flac', 'FLAC magic bytes');
  if (asciiAt(buffer, 0, 4) === 'OggS') return build('ogg', 'OggS magic bytes');
  if (asciiAt(buffer, 0, 3) === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return build('mp3', 'MPEG audio frame/ID3 header');
  if (asciiAt(buffer, 4, 4) === 'ftyp') {
    const brand = asciiAt(buffer, 8, 4).toLowerCase();
    if (brand.startsWith('m4a') || brand.startsWith('m4b')) return build('m4a', `ISO-BMFF ftyp brand ${brand}`);
    if (brand.startsWith('qt')) return build('mov', `ISO-BMFF ftyp brand ${brand}`);
    return build('mp4', `ISO-BMFF ftyp brand ${brand}`);
  }
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return build('mkv', 'Matroska/WebM EBML header');
  if (asciiAt(buffer, 0, 4) === 'FORM' && asciiAt(buffer, 8, 4) === 'AIFF') return build('wav', 'AIFF container');

  // --- Textual -------------------------------------------------------------
  if (looksLikeText(buffer)) {
    const result = sniffTextual(buffer, filenameHint);
    // A declared MIME can refine an otherwise generic text verdict.
    if (result.kind === 'text' && declaredMime) {
      const mime = declaredMime.toLowerCase();
      if (mime.includes('html')) return build('html', 'declared text/html with textual bytes');
      if (mime.includes('json')) return build('json', 'declared application/json with textual bytes');
      if (mime.includes('csv')) return build('csv', 'declared text/csv with textual bytes');
      if (mime.includes('xml')) return build('xml', 'declared XML with textual bytes');
      if (mime.includes('markdown')) return build('markdown', 'declared text/markdown with textual bytes');
    }
    return result;
  }

  return build('unknown', 'no recognised signature and not decodable text');
}

/** Convenience: is this kind something we can read as text directly? */
export function isTextualKind(kind: ContentKind): boolean {
  return TEXTUAL_KINDS.has(kind);
}

export function describeKind(kind: ContentKind): { label: string; family: SniffResult['family']; mimeType: string } {
  return LABELS[kind];
}
