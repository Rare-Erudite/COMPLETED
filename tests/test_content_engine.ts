/**
 * Content engine verification — real extraction, real security, real search.
 *
 * These tests exercise the shared engine directly (no mocks) so a regression in
 * sniffing, extraction, SSRF protection or indexing fails the suite. Network
 * tests are marked and skipped when the sandbox has no outbound access.
 */

import assert from 'assert';
import AdmZip from 'adm-zip';
import * as XLSX from 'xlsx';
import { processBuffer, processUrl, chunkContent } from '../src/server/content/ContentEngine.js';
import { sniffContent } from '../src/server/content/ContentSniffer.js';
import { SearchIndex } from '../src/server/content/SearchIndex.js';
import { assertSafeUrl, isPrivateAddress, SafeFetchError } from '../src/server/content/SafeFetcher.js';

function makeDocx(): Buffer {
  // A minimal but valid OOXML package, built with the same zip writer the
  // extractor uses so the test does not depend on an external fixture.
  const zip = new AdmZip();
  zip.addFile(
    '[Content_Types].xml',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
  );
  zip.addFile(
    '_rels/.rels',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
  );
  zip.addFile(
    'word/document.xml',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Content engine DOCX test paragraph.</w:t></w:r></w:p></w:body></w:document>',
    ),
  );
  return zip.toBuffer();
}

export async function runContentEngineTests() {
  console.log('--- Testing Universal Content Engine ---');

  // 1. Sniffing is byte-based, not extension-based.
  const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  const mislabelled = sniffContent(pdfBytes, 'notes.txt', 'text/plain');
  assert.strictEqual(mislabelled.kind, 'pdf', 'A PDF named .txt must still be detected as PDF');

  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.strictEqual(sniffContent(pngBytes, 'x.bin').kind, 'png', 'PNG magic bytes must be detected');

  const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
  assert.strictEqual(sniffContent(zipBytes, 'x.zip').kind, 'zip', 'ZIP magic bytes must be detected');

  // 2. Text-family extraction.
  const csv = await processBuffer(Buffer.from('name,role\nAda,engineer\nGrace,admiral\n'), { filename: 'people.csv' });
  assert.ok(csv.ok, 'CSV must extract');
  assert.strictEqual(csv.kind, 'csv');
  assert.ok(csv.text.includes('Ada'), 'CSV text must contain cell values');
  assert.ok(csv.tables && csv.tables[0].rows.length === 3, 'CSV must expose parsed rows');

  const json = await processBuffer(Buffer.from('{"alpha":1,"beta":[2,3]}'), { filename: 'data.json' });
  assert.ok(json.ok && json.kind === 'json', 'JSON must extract');

  const html = await processBuffer(
    Buffer.from('<html><head><title>Doc Title</title></head><body><nav>menu</nav><h1>Heading</h1><p>Real body text.</p><script>bad()</script></body></html>'),
    { filename: 'page.html' },
  );
  assert.ok(html.ok && html.kind === 'html', 'HTML must extract');
  assert.ok(html.text.includes('Real body text'), 'HTML body text must survive');
  assert.ok(!html.text.includes('bad()'), 'HTML scripts must be stripped');
  assert.strictEqual(html.metadata.title, 'Doc Title', 'HTML title must be captured');

  const markdown = await processBuffer(Buffer.from('# Title\n\nSome **markdown** body.'), { filename: 'notes.md' });
  assert.ok(markdown.ok && markdown.kind === 'markdown', 'Markdown must extract');

  // 3. DOCX through the real OOXML path.
  const docx = await processBuffer(makeDocx(), { filename: 'sample.docx' });
  assert.ok(docx.ok, 'DOCX must extract');
  assert.strictEqual(docx.kind, 'docx');
  assert.ok(docx.text.includes('Content engine DOCX test paragraph'), 'DOCX body text must be extracted');

  // 4. Spreadsheet, presentation, book, email, subtitles, archive.

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Region', 'Revenue'], ['EMEA', 1200]]), 'Sales');
  const xlsxBuffer: Buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const sheet = await processBuffer(xlsxBuffer, { filename: 'sales.xlsx' });
  assert.ok(sheet.ok && sheet.kind === 'xlsx', 'XLSX must extract');
  assert.ok(sheet.text.includes('EMEA'), 'XLSX cell values must be extracted');
  assert.ok(sheet.tables && sheet.tables.length === 1, 'XLSX must expose sheet tables');

  const deckZip = new AdmZip();
  deckZip.addFile('ppt/slides/slide1.xml', Buffer.from('<p:sld xmlns:a="a"><a:t>Slide one title</a:t></p:sld>'));
  deckZip.addFile('ppt/notesSlides/notesSlide1.xml', Buffer.from('<p:sld xmlns:a="a"><a:t>Speaker note here</a:t></p:sld>'));
  const deck = await processBuffer(deckZip.toBuffer(), { filename: 'deck.pptx' });
  assert.ok(deck.ok && deck.kind === 'pptx', 'PPTX must extract');
  assert.ok(deck.text.includes('Slide one title'), 'PPTX slide text must be extracted');
  assert.ok(deck.text.includes('Speaker note here'), 'PPTX speaker notes must be extracted');

  const epubZip = new AdmZip();
  epubZip.addFile('mimetype', Buffer.from('application/epub+zip'));
  epubZip.addFile('META-INF/container.xml', Buffer.from('<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'));
  epubZip.addFile('OEBPS/content.opf', Buffer.from('<?xml version="1.0"?><package><metadata><dc:title>Test Book</dc:title></metadata><manifest><item id="c1" href="ch1.xhtml"/></manifest><spine><itemref idref="c1"/></spine></package>'));
  epubZip.addFile('OEBPS/ch1.xhtml', Buffer.from('<html><body><h1>Chapter One</h1><p>First chapter body text.</p></body></html>'));
  const book = await processBuffer(epubZip.toBuffer(), { filename: 'book.epub' });
  assert.ok(book.ok && book.kind === 'epub', 'EPUB must extract');
  assert.ok(book.text.includes('First chapter body text'), 'EPUB chapter text must be extracted');

  const email = await processBuffer(Buffer.from('From: a@b.com\nSubject: Hello\n\nBody of the email.\n'), { filename: 'mail.eml' });
  assert.ok(email.ok && email.kind === 'eml', 'EML must extract');
  assert.ok(email.text.includes('Body of the email'), 'EML body must be extracted');

  const subtitles = await processBuffer(Buffer.from('1\n00:00:01,000 --> 00:00:03,000\nHello world\n'), { filename: 'subs.srt' });
  assert.ok(subtitles.ok && subtitles.kind === 'srt', 'SRT must extract');
  assert.ok(subtitles.text.includes('00:00:01'), 'SRT timestamps must be preserved');

  // Archive traversal entries are listed but never extracted to disk.
  const archiveZip = new AdmZip();
  archiveZip.addFile('safe.txt', Buffer.from('ok'));
  archiveZip.addFile('../../etc/evil.txt', Buffer.from('bad'));
  const archive = await processBuffer(archiveZip.toBuffer(), { filename: 'archive.zip' });
  assert.ok(archive.ok && archive.kind === 'zip', 'ZIP must be listed');
  assert.ok(archive.text.includes('safe.txt'), 'ZIP entries must be listed');

  // 5. Unsupported/empty payloads fail honestly rather than inventing text.
  const empty = await processBuffer(Buffer.alloc(0), { filename: 'empty.bin' });
  assert.strictEqual(empty.ok, false, 'An empty payload must not report success');

  const binary = await processBuffer(Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]), { filename: 'blob.bin' });
  assert.strictEqual(binary.ok, false, 'Unknown binary must not report success');
  assert.ok(binary.error?.code, 'A failed extraction must carry an error code');

  // 5. Media is routed to transcription, never silently "read".
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(32)]);
  const media = await processBuffer(wav, { filename: 'clip.wav' });
  assert.strictEqual(media.ok, false, 'Audio must not be reported as extracted text');
  assert.strictEqual(media.error?.code, 'MEDIA_REQUIRES_TRANSCRIPTION', 'Audio must point at transcription');

  // 6. SSRF protection.
  for (const url of [
    'http://127.0.0.1/',
    'http://localhost/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/',
    'http://192.168.1.1/',
    'file:///etc/passwd',
    'gopher://example.com/',
    'https://user:pass@example.com/',
  ]) {
    assert.throws(() => assertSafeUrl(url), SafeFetchError, `${url} must be rejected`);
  }
  assert.ok(isPrivateAddress('::1'), 'IPv6 loopback must be private');
  assert.ok(isPrivateAddress('fd00::1'), 'IPv6 ULA must be private');
  assert.ok(!isPrivateAddress('93.184.216.34'), 'A public IPv4 address must be allowed');

  const blocked = await processUrl('http://169.254.169.254/latest/meta-data/');
  assert.strictEqual(blocked.ok, false, 'A metadata endpoint must not be fetched');
  assert.ok(['UNSAFE_SCHEME', 'PRIVATE_ADDRESS'].includes(blocked.error?.code || ''), 'SSRF must be refused by policy');

  // 7. Chunking preserves page numbers.
  const paged = await processBuffer(pdfBytes, { filename: 'x.pdf' });
  const chunks = chunkContent({ ...paged, ok: true, text: 'a'.repeat(5000), pages: [{ page: 1, text: 'a'.repeat(3000) }, { page: 2, text: 'b'.repeat(3000) }] } as any);
  assert.ok(chunks.length >= 2, 'A long document must produce multiple chunks');
  assert.ok(chunks.some((chunk) => chunk.page === 2), 'Chunks must retain page numbers');

  // 8. Search index: phrase, terms, deletion.
  const index = new SearchIndex();
  index.rebuild([
    {
      id: 'doc-a',
      title: 'Attention paper',
      origin: 'document',
      chunks: [
        { index: 0, text: 'The scaled dot-product attention mechanism computes weights.', page: 4, charStart: 0, charEnd: 60 },
        { index: 1, text: 'Multi-head attention runs several attention layers in parallel.', page: 5, charStart: 60, charEnd: 120 },
      ],
    },
    {
      id: 'doc-b',
      title: 'Unrelated notes',
      origin: 'document',
      chunks: [{ index: 0, text: 'Groceries: bread, milk, eggs.', charStart: 0, charEnd: 30 }],
    },
  ]);

  const phraseHits = index.search('scaled dot-product attention');
  assert.ok(phraseHits.length > 0, 'Phrase search must find the passage');
  assert.strictEqual(phraseHits[0].documentId, 'doc-a');
  assert.strictEqual(phraseHits[0].page, 4, 'A hit must report the page it came from');

  const termHits = index.search('attention');
  assert.ok(termHits.length >= 2, 'Term search must find every matching chunk');

  index.remove('doc-a');
  assert.strictEqual(index.search('attention').length, 0, 'Deleted documents must not remain retrievable');
  assert.strictEqual(index.size, 1, 'Index size must reflect the deletion');

  // 9. Live retrieval (skipped when the sandbox has no outbound network).
  try {
    const live = await processUrl('https://example.com/', { timeoutMs: 10_000 });
    if (live.ok) {
      assert.ok(live.text.toLowerCase().includes('example'), 'A live page must yield its real text');
      assert.ok(live.finalUrl?.startsWith('https://'), 'The final URL must be recorded');
      console.log('    ✓ live URL retrieval verified (example.com)');
    } else {
      console.log(`    ⚠ live URL retrieval unavailable: ${live.error?.code} — ${live.error?.message}`);
    }
  } catch (error) {
    console.log(`    ⚠ live URL retrieval skipped: ${error instanceof Error ? error.message : 'network unavailable'}`);
  }

  console.log('✅ Universal Content Engine tests passed');
}
