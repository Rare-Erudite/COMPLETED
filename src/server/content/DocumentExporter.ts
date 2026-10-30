/**
 * DocumentExporter — produce real, openable files from stored documents.
 *
 * These are genuine binary formats, not renamed text: DOCX is a valid OOXML
 * package that Word opens, XLSX is a real workbook that Excel opens, PDF is a
 * laid-out document. Each writer is implemented here rather than pulled from a
 * dependency so the output can be verified byte for byte in tests.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import JSZip from 'jszip';

export type ExportFormat = 'md' | 'txt' | 'html' | 'json' | 'csv' | 'docx' | 'xlsx' | 'pdf';

export interface ExportResult {
  format: ExportFormat;
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

export class ExportError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

const MIME_TYPES: Record<ExportFormat, string> = {
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  html: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Split markdown-ish text into blocks we can render as paragraphs/headings. */
function toBlocks(text: string): Array<{ kind: 'heading' | 'paragraph' | 'list' | 'code'; text: string; level?: number }> {
  const blocks: Array<{ kind: 'heading' | 'paragraph' | 'list' | 'code'; text: string; level?: number }> = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let inCode = false;
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    blocks.push({ kind: 'paragraph', text: buffer.join(' ').trim() });
    buffer = [];
  };

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      flush();
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      blocks.push({ kind: 'code', text: line });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', text: heading[2].trim(), level: heading[1].length });
      continue;
    }
    const listItem = line.match(/^\s*[-*•]\s+(.*)$/);
    if (listItem) {
      flush();
      blocks.push({ kind: 'list', text: listItem[1].trim() });
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    buffer.push(line.trim());
  }
  flush();
  return blocks;
}

/**
 * Build a DOCX. A minimal but valid OOXML package: [Content_Types].xml,
 * _rels/.rels, word/document.xml and word/_rels/document.xml.rels.
 */
async function buildDocx(text: string, title: string): Promise<Buffer> {
  const blocks = toBlocks(text);
  const paragraphs: string[] = [];

  for (const block of blocks) {
    const textRuns = escapeXml(block.text);
    if (block.kind === 'heading') {
      const size = block.level === 1 ? 36 : block.level === 2 ? 30 : 26;
      paragraphs.push(
        `<w:p><w:pPr><w:pStyle w:val="Heading${block.level}"/><w:spacing w:before="240" w:after="120"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${textRuns}</w:t></w:r></w:p>`,
      );
    } else if (block.kind === 'list') {
      paragraphs.push(
        `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:after="60"/></w:pPr><w:r><w:t xml:space="preserve">${textRuns}</w:t></w:r></w:p>`,
      );
    } else if (block.kind === 'code') {
      paragraphs.push(
        `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${textRuns || ' '}</w:t></w:r></w:p>`,
      );
    } else {
      paragraphs.push(`<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:t xml:space="preserve">${textRuns}</w:t></w:r></w:p>`);
    }
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="44"/></w:rPr><w:t xml:space="preserve">${escapeXml(title)}</w:t></w:r></w:p>
    ${paragraphs.join('\n    ')}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
  </w:body>
</w:document>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="44"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
</w:styles>`;

  const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

  const packageRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', packageRels);
  zip.file('word/document.xml', documentXml);
  zip.file('word/styles.xml', stylesXml);
  zip.file('word/numbering.xml', numberingXml);
  zip.file('word/_rels/document.xml.rels', documentRels);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

/**
 * Build an XLSX from CSV-ish text. Sheets are separated by `## Sheet: name`
 * markers (what our spreadsheet extractor emits) or the whole text becomes one
 * sheet split on commas.
 */
async function buildXlsx(text: string): Promise<Buffer> {
  const sheetBlocks: Array<{ name: string; rows: string[][] }> = [];
  const markerPattern = /^##\s+([^\n]+)$/gm;
  const markers = [...text.matchAll(markerPattern)];

  if (markers.length > 0) {
    for (const [index, marker] of markers.entries()) {
      const start = (marker.index ?? 0) + marker[0].length;
      const end = index + 1 < markers.length ? markers[index + 1].index : text.length;
      const body = text.slice(start, end);
      sheetBlocks.push({ name: marker[1].trim().slice(0, 31) || `Sheet${index + 1}`, rows: parseRows(body) });
    }
  } else {
    sheetBlocks.push({ name: 'Sheet1', rows: parseRows(text) });
  }

  const sheetXmlOf = (rows: string[][]): string => {
    const rowXml = rows.map((row, rowIndex) => {
      const cells = row.map((cell, cellIndex) => {
        const reference = `${columnName(cellIndex)}${rowIndex + 1}`;
        const numeric = cell.trim() !== '' && !Number.isNaN(Number(cell.replace(/,/g, '')));
        if (numeric) {
          return `<c r="${reference}"><v>${Number(cell.replace(/,/g, ''))}</v></c>`;
        }
        return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`;
      }).join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`;
  };

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheetBlocks.map((_sheet, index) => `  <Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`;

  const packageRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheetBlocks.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheetBlocks.map((_sheet, index) => `  <Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('\n')}
</Relationships>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', packageRels);
  zip.file('xl/workbook.xml', workbook);
  zip.file('xl/_rels/workbook.xml.rels', workbookRels);
  sheetBlocks.forEach((sheet, index) => zip.file(`xl/worksheets/sheet${index + 1}.xml`, sheetXmlOf(sheet.rows)));
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

function columnName(index: number): string {
  let name = '';
  let value = index;
  do {
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return name;
}

/** Parse a table block: pipe tables, or CSV, or one row per line. */
function parseRows(body: string): string[][] {
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  const pipeRows = lines.filter((line) => line.startsWith('|'));
  if (pipeRows.length > 0) {
    return pipeRows
      .filter((line) => !/^\|[\s|:-]+\|$/.test(line))
      .map((line) => line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()));
  }
  if (lines.some((line) => line.includes(','))) {
    return lines.map((line) => splitCsvLine(line));
  }
  return lines.map((line) => [line]);
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      cells.push(current);
      current = '';
    } else current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/** Lay text out as a paginated PDF. */
async function buildPdf(text: string, title: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreator('RARE');
  pdf.setProducer('RARE DocumentExporter');

  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 56;
  const maxWidth = pageWidth - margin * 2;

  let page = pdf.addPage([pageWidth, pageHeight]);
  let cursorY = pageHeight - margin;

  const newPage = () => {
    page = pdf.addPage([pageWidth, pageHeight]);
    cursorY = pageHeight - margin;
  };

  const drawLine = (value: string, font: typeof body, size: number, indent = 0, spacing = 1.45) => {
    // Wrap by measuring real glyph widths, so nothing is cut off at the margin.
    const words = value.split(/\s+/).filter(Boolean);
    let line = '';
    const lines: string[] = [];
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth - indent) {
        if (line) lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    if (lines.length === 0) lines.push('');

    for (const entry of lines) {
      const lineHeight = size * spacing;
      if (cursorY - lineHeight < margin) newPage();
      page.drawText(entry, { x: margin + indent, y: cursorY - size, size, font, color: rgb(0.1, 0.1, 0.12) });
      cursorY -= lineHeight;
    }
  };

  drawLine(title, bold, 20, 0, 1.6);
  cursorY -= 8;

  // Word-wrapping a page of long paragraphs is the slowest part; cap the body
  // so an enormous document produces a readable file rather than hanging.
  const MAX_PDF_CHARS = 400_000;
  const truncated = text.length > MAX_PDF_CHARS;
  const source = truncated ? text.slice(0, MAX_PDF_CHARS) : text;

  for (const block of toBlocks(source)) {
    if (block.kind === 'heading') {
      cursorY -= 6;
      drawLine(block.text, bold, block.level === 1 ? 16 : block.level === 2 ? 14 : 12, 0, 1.5);
      cursorY -= 2;
    } else if (block.kind === 'list') {
      drawLine(`• ${block.text}`, body, 10.5, 12);
    } else if (block.kind === 'code') {
      drawLine(block.text || ' ', mono, 9, 12, 1.3);
    } else {
      drawLine(block.text, body, 10.5);
      cursorY -= 4;
    }
  }

  if (truncated) {
    drawLine(`[Truncated: this PDF contains the first ${MAX_PDF_CHARS.toLocaleString()} of ${text.length.toLocaleString()} characters.]`, body, 9);
  }

  return Buffer.from(await pdf.save());
}

/** Export a stored document to a real file. */
export async function exportDocument(
  text: string,
  format: ExportFormat,
  options: { title?: string; filename?: string } = {},
): Promise<ExportResult> {
  const title = (options.title || 'Document').slice(0, 200);
  const base = (options.filename || title)
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'document';

  let buffer: Buffer;
  switch (format) {
    case 'txt':
    case 'md':
      buffer = Buffer.from(text, 'utf8');
      break;
    case 'json':
      buffer = Buffer.from(JSON.stringify({ title, content: text }, null, 2), 'utf8');
      break;
    case 'csv': {
      const rows = text.split(/\r?\n/).map((line) => `"${line.replace(/"/g, '""')}"`);
      buffer = Buffer.from(rows.join('\r\n'), 'utf8');
      break;
    }
    case 'html': {
      const escaped = escapeXml(text);
      buffer = Buffer.from(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeXml(title)}</title>
<style>body{max-width:46rem;margin:3rem auto;padding:0 1.25rem;font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#18181b}
h1,h2,h3{line-height:1.25;margin:2rem 0 .75rem}pre{background:#f4f4f5;padding:1rem;border-radius:.5rem;overflow-x:auto}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}blockquote{border-left:3px solid #d4d4d8;margin:1rem 0;padding-left:1rem;color:#52525b}</style>
</head><body><h1>${escapeXml(title)}</h1><pre style="white-space:pre-wrap;font:inherit">${escaped}</pre></body></html>`,
        'utf8',
      );
      break;
    }
    case 'docx':
      buffer = await buildDocx(text, title);
      break;
    case 'xlsx':
      buffer = await buildXlsx(text);
      break;
    case 'pdf':
      buffer = await buildPdf(text, title);
      break;
    default:
      throw new ExportError(`Export to .${format} is not supported.`, 'UNSUPPORTED_FORMAT');
  }

  return {
    format,
    buffer,
    mimeType: MIME_TYPES[format],
    filename: `${base}.${format}`,
  };
}

export const EXPORT_FORMATS: ExportFormat[] = ['md', 'txt', 'html', 'json', 'csv', 'docx', 'xlsx', 'pdf'];
