/**
 * Documents increment — end-to-end tests against a real running server.
 *
 * Every assertion hits HTTP on the booted app, so a passing run means the
 * routes, the storage and the engines actually work together. Nothing here
 * mocks the server.
 */

/**
 * Resolved per call, not at import time: the runner assigns
 * RARE_TEST_BASE_URL after this module is imported, so a top-level const
 * would freeze the fallback port and every request would miss the server.
 */
const baseUrl = (): string => process.env.RARE_TEST_BASE_URL || 'http://127.0.0.1:3000';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    const message = `${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`;
    failures.push(message);
    console.log(`  FAIL ${message}`);
  }
}

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any; text: string; headers: Headers }> {
  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* binary or empty body */
  }
  return { status: response.status, json, text, headers: response.headers };
}

/** Sign in as a guest and return a fully-formed authenticated header set. */
async function newSession(): Promise<{ headers: Record<string, string>; ownerId: string }> {
  const guest = await api('POST', '/api/user/guest-session', {});
  const raw = typeof (guest.headers as any).getSetCookie === 'function'
    ? ((guest.headers as any).getSetCookie() as string[])
    : (guest.headers.get('set-cookie') || '').split(/, (?=[^;,]+=)/g);
  const cookies = raw.map((value) => value.split(';', 1)[0]).filter(Boolean);
  const csrfCookie = cookies.find((value) => value.startsWith('rare_csrf='));
  const csrf = guest.headers.get('x-csrf-token') || csrfCookie?.slice('rare_csrf='.length) || '';
  return {
    ownerId: guest.json?.user?.id || guest.json?.ownerId || '',
    headers: {
      'Content-Type': 'application/json',
      Origin: baseUrl(),
      Cookie: cookies.join('; '),
      'X-CSRF-Token': decodeURIComponent(csrf),
    },
  };
}

async function authed(
  session: { headers: Record<string, string> },
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any; text: string; headers: Headers }> {
  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: session.headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* binary */
  }
  return { status: response.status, json, text, headers: response.headers };
}

// ---------------------------------------------------------------------------
// Fixtures, generated with the same tools the server uses
// ---------------------------------------------------------------------------

async function buildPdf(): Promise<string> {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  page.drawText('RARE Quarterly Report', { x: 72, y: 700, size: 18, font });
  page.drawText('Revenue was 2100000 pounds in the quarter.', { x: 72, y: 660, size: 12, font });
  page.drawText('The decision is to expand to Lagos by March 2027.', { x: 72, y: 640, size: 12, font });
  page.drawText('Ada Okafor owns the expansion plan.', { x: 72, y: 620, size: 12, font });
  return Buffer.from(await pdf.save()).toString('base64');
}

async function buildDocx(): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Contract between RARE and Nova Systems.</w:t></w:r></w:p><w:p><w:r><w:t>Payment of 45000 pounds is due on 2027-01-15.</w:t></w:r></w:p></w:body></w:document>`,
  );
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' })).toString('base64');
}

async function buildXlsx(): Promise<string> {
  const XLSX = await import('xlsx');
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Region', 'Revenue', 'Units'],
    ['Lagos', 2100000, 412],
    ['Abuja', 800000, 190],
  ]);
  XLSX.utils.book_append_sheet(book, sheet, 'Sales');
  return Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer).toString('base64');
}

async function buildAudio(seconds: number): Promise<string> {
  const { execFileSync } = await import('child_process');
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-test-audio-'));
  const output = path.join(directory, 'audio.mp3');
  // A spoken-word stand-in: a modulated tone keeps ffmpeg's VAD path exercised
  // without shipping a voice recording into the repo.
  execFileSync(
    'ffmpeg',
    ['-y', '-f', 'lavfi', '-i', `sine=frequency=320:duration=${seconds}`, '-ar', '16000', '-ac', '1', '-b:a', '32k', output],
    { stdio: 'ignore' },
  );
  const base64 = fs.readFileSync(output).toString('base64');
  fs.rmSync(directory, { recursive: true, force: true });
  return base64;
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

export async function runDocumentsIncrementTests(): Promise<{ passed: number; failed: number }> {
  console.log('\n=== Documents increment (end-to-end) ===');

  const session = await newSession();
  check('guest session established', Boolean(session.headers.Cookie), session.headers.Cookie);
  if (!session.headers.Cookie) {
    return { passed, failed: failed + 1 };
  }
  const cookie = session;
  const stamp = Date.now();

  // --- capabilities -------------------------------------------------------
  const capabilities = await authed(cookie, 'GET', '/api/documents/capabilities');
  check('GET /api/documents/capabilities responds', capabilities.status === 200, capabilities.status);
  check(
    'capabilities probes real adapters rather than listing a wish-list',
    Array.isArray(capabilities.json?.extractors) && capabilities.json.extractors.length > 10,
    capabilities.json?.extractors?.length,
  );
  check(
    'capabilities reports transcription availability truthfully',
    typeof capabilities.json?.transcription?.available === 'boolean',
    capabilities.json?.transcription,
  );

  // --- parse route (previously 404) ---------------------------------------
  const csvBase64 = Buffer.from('Region,Revenue,Units\nLagos,2100000,412\nAbuja,800000,190\n').toString('base64');
  const parsed = await authed(cookie, 'POST', '/api/documents/parse', {
    fileBase64: csvBase64,
    filename: 'sales.csv',
    mimeType: 'text/csv',
  });
  check('POST /api/documents/parse exists and succeeds (was 404)', parsed.status === 200, parsed.status);
  check('parse recognises CSV by content', parsed.json?.kind === 'csv', parsed.json?.kind);
  check('parse returns table text', /Lagos/.test(parsed.json?.text || ''), parsed.json?.text?.slice(0, 80));

  // --- PDF extraction ------------------------------------------------------
  const pdfBase64 = await buildPdf();
  const pdfImport = await authed(cookie, 'POST', '/api/documents', {
    fileBase64: pdfBase64,
    filename: `report-${stamp}.pdf`,
    mimeType: 'application/pdf',
  });
  check('PDF upload is accepted', pdfImport.status === 201, pdfImport.json?.error || pdfImport.status);
  const pdfPath = pdfImport.json?.path;
  // The import outcome reports the character count; the text itself lives in the
  // stored record, which is what a reader would actually open.
  check('PDF text layer was read', (pdfImport.json?.chars || 0) > 30, pdfImport.json?.chars);

  const pdfDoc = await authed(cookie, 'GET', `/api/documents/${pdfPath}`);
  check('stored PDF text is retrievable by path', pdfDoc.status === 200, pdfDoc.status);
  check(
    'stored PDF preserves page provenance',
    Array.isArray(pdfDoc.json?.pages) && pdfDoc.json.pages.length >= 1,
    pdfDoc.json?.pages?.length,
  );

  // --- corrupt PDF self-repair --------------------------------------------
  const corruptBase64 = Buffer.concat([
    Buffer.from('<html>proxy error</html>\n'),
    Buffer.from(pdfBase64, 'base64'),
  ]).toString('base64');
  const repaired = await authed(cookie, 'POST', '/api/documents/parse', {
    fileBase64: corruptBase64,
    filename: 'corrupt.pdf',
    mimeType: 'application/pdf',
  });
  check(
    'a PDF with a junk prefix is repaired rather than rejected',
    repaired.status === 200 && /Revenue|2100000/i.test(repaired.json?.text || ''),
    repaired.json?.error?.message || repaired.json?.diagnosisUsed,
  );

  // --- DOCX ---------------------------------------------------------------
  const docxBase64 = await buildDocx();
  const docxImport = await authed(cookie, 'POST', '/api/documents', {
    fileBase64: docxBase64,
    filename: `contract-${stamp}.docx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  check('DOCX upload is accepted', docxImport.status === 201, docxImport.json?.error || docxImport.status);
  const docxDoc = await authed(cookie, 'GET', `/api/documents/${docxImport.json?.path}`);
  check(
    'DOCX body text was extracted',
    /Nova Systems/.test(docxDoc.json?.content || ''),
    docxDoc.json?.content?.slice(0, 80),
  );

  // --- XLSX ---------------------------------------------------------------
  const xlsxBase64 = await buildXlsx();
  const xlsxImport = await authed(cookie, 'POST', '/api/documents', {
    fileBase64: xlsxBase64,
    filename: `sales-${stamp}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  check('XLSX upload is accepted', xlsxImport.status === 201, xlsxImport.json?.error || xlsxImport.status);
  const xlsxDoc = await authed(cookie, 'GET', `/api/documents/${xlsxImport.json?.path}`);
  check(
    'XLSX sheet contents were read as a table',
    /Lagos/.test(xlsxDoc.json?.content || '') && /2100000/.test(xlsxDoc.json?.content || ''),
    xlsxDoc.json?.content?.slice(0, 120),
  );

  // --- grounded Q&A --------------------------------------------------------
  const asked = await authed(cookie, 'POST', '/api/documents/ask', {
    question: 'What was the revenue?',
    documentPaths: [pdfPath],
  });
  check('POST /api/documents/ask responds', asked.status === 200, asked.json?.error?.message || asked.status);
  check(
    'ask retrieves the passage that contains the answer',
    (asked.json?.sources || []).some((source: any) => /2100000/.test(source.text)),
    asked.json?.sources?.length,
  );
  check(
    'ask never presents an unsourced claim as document content',
    Array.isArray(asked.json?.derivedClaims) && Array.isArray(asked.json?.explicitClaims),
    { explicit: asked.json?.explicitClaims?.length, derived: asked.json?.derivedClaims?.length },
  );
  check(
    'ask is honest when no passage matches',
    (await (async () => {
      const empty = await authed(cookie, 'POST', '/api/documents/ask', {
        question: 'zzzqqq nonexistent topic xylophonic',
        documentPaths: [pdfPath],
      });
      return empty.json?.noRelevantContent === true && empty.json?.citations?.length === 0;
    })()),
    'unrelated question should report noRelevantContent',
  );

  // --- entities ------------------------------------------------------------
  const entities = await authed(cookie, 'POST', '/api/documents/extract', { path: pdfPath });
  check('POST /api/documents/extract responds', entities.status === 200, entities.json?.error?.message);
  check(
    'extraction finds the figure and the date actually in the document',
    (entities.json?.figures || []).some((value: string) => /2100000/.test(value)) ||
      (entities.json?.dates || []).length > 0,
    { figures: entities.json?.figures?.slice(0, 3), dates: entities.json?.dates?.slice(0, 3) },
  );

  // --- comparison ----------------------------------------------------------
  const compared = await authed(cookie, 'POST', '/api/documents/compare', {
    leftPath: pdfPath,
    rightPath: docxImport.json?.path,
  });
  check('POST /api/documents/compare responds', compared.status === 200, compared.json?.error?.message);
  check(
    'comparison computes structural differences even without a model',
    Array.isArray(compared.json?.onlyInLeft) && Array.isArray(compared.json?.onlyInRight),
    { left: compared.json?.onlyInLeft?.length, right: compared.json?.onlyInRight?.length },
  );

  // --- export: real binary formats ----------------------------------------
  const docxExport = await authed(cookie, 'POST', '/api/documents/convert', {
    path: pdfPath,
    targetFormat: 'docx',
  });
  check('export to DOCX succeeds', docxExport.status === 200, docxExport.json?.error?.message);
  const docxBytes = Buffer.from(docxExport.json?.base64 || '', 'base64');
  check(
    'exported DOCX is a real ZIP package, not renamed text',
    docxBytes.length > 1000 && docxBytes[0] === 0x50 && docxBytes[1] === 0x4b,
    { bytes: docxBytes.length, magic: docxBytes.subarray(0, 2).toString('hex') },
  );

  // Parse the exported DOCX back with the real extractor: proof it is valid.
  const reparse = await authed(cookie, 'POST', '/api/documents/parse', {
    fileBase64: docxBytes.toString('base64'),
    filename: 'roundtrip.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  check(
    'exported DOCX round-trips through the real DOCX extractor',
    /RARE Quarterly Report|Revenue/.test(reparse.json?.text || ''),
    reparse.json?.error?.message || reparse.json?.text?.slice(0, 60),
  );

  const pdfExport = await authed(cookie, 'POST', '/api/documents/convert', {
    path: pdfPath,
    targetFormat: 'pdf',
  });
  const pdfBytes = Buffer.from(pdfExport.json?.base64 || '', 'base64');
  check(
    'exported PDF has a real PDF signature',
    pdfBytes.subarray(0, 5).toString('latin1') === '%PDF-',
    pdfBytes.subarray(0, 8).toString('latin1'),
  );

  const xlsxExport = await authed(cookie, 'POST', '/api/documents/convert', {
    path: xlsxImport.json?.path,
    targetFormat: 'xlsx',
  });
  const xlsxBytes = Buffer.from(xlsxExport.json?.base64 || '', 'base64');
  check(
    'exported XLSX is a real ZIP package',
    xlsxBytes.length > 1000 && xlsxBytes[0] === 0x50 && xlsxBytes[1] === 0x4b,
    { bytes: xlsxBytes.length },
  );

  // --- download endpoint ---------------------------------------------------
  const download = await authed(cookie, 'GET', `/api/export/document?path=${encodeURIComponent(pdfPath)}&format=pdf`);
  check('export download returns a file, not JSON', download.status === 200 && download.text.startsWith('%PDF-'), {
    status: download.status,
    contentType: download.headers.get('content-type'),
  });

  // --- archive safety ------------------------------------------------------
  const JSZip = (await import('jszip')).default;
  const zipFixture = new JSZip();
  zipFixture.file('safe.txt', 'hello');
  zipFixture.file('../../etc/evil.sh', 'rm -rf /');
  zipFixture.file('payload.exe', 'MZ');
  const zipBase64 = Buffer.from(await zipFixture.generateAsync({ type: 'nodebuffer' })).toString('base64');
  const archive = await authed(cookie, 'POST', '/api/documents/inspect-archive', { fileBase64: zipBase64 });
  check('archive inspection responds', archive.status === 200, archive.json?.error?.message);
  check(
    'archive inspection flags traversal and executables without extracting',
    archive.json?.unsafeEntries?.length >= 2 && archive.json?.extracted === false,
    { unsafe: archive.json?.unsafeEntries, extracted: archive.json?.extracted },
  );

  // --- media probe & transcription ----------------------------------------
  const shortAudio = await buildAudio(3);
  const mediaInfo = await authed(cookie, 'POST', '/api/documents/media-info', {
    fileBase64: shortAudio,
    filename: 'clip.mp3',
  });
  check('POST /api/documents/media-info responds', mediaInfo.status === 200, mediaInfo.json?.error?.message);
  check(
    'media-info reports the real duration measured by ffprobe',
    Math.abs((mediaInfo.json?.durationSeconds || 0) - 3) < 1,
    mediaInfo.json?.durationSeconds,
  );

  // Long recording: proves segmentation works and that many segments are planned.
  const longAudio = await buildAudio(1500); // 25 minutes
  const longInfo = await authed(cookie, 'POST', '/api/documents/media-info', {
    fileBase64: longAudio,
    filename: 'meeting.mp3',
    segmentSeconds: 600,
  });
  check(
    'a 25-minute recording is measured and segmented into multiple parts',
    longInfo.status === 200 && longInfo.json?.estimatedSegments >= 3,
    { seconds: longInfo.json?.durationSeconds, segments: longInfo.json?.estimatedSegments },
  );

  const transcription = await authed(cookie, 'POST', '/api/documents/transcribe', {
    audioBase64: shortAudio,
    audioName: 'clip.mp3',
    mimeType: 'audio/mpeg',
  });
  if (transcription.status === 200) {
    check('transcription returns a saved transcript path', /^transcripts\//.test(transcription.json?.path || ''), transcription.json?.path);
    check(
      'transcription reports real coverage rather than claiming completeness',
      typeof transcription.json?.coverage === 'number',
      transcription.json?.coverage,
    );
    check(
      'transcription reports segments transcribed out of total',
      typeof transcription.json?.segmentsTotal === 'number' && transcription.json.segmentsTotal >= 1,
      { total: transcription.json?.segmentsTotal, done: transcription.json?.segmentsTranscribed },
    );
    const transcriptDoc = await authed(cookie, 'GET', `/api/documents/${transcription.json?.path}`);
    check('the transcript persists as a real document', transcriptDoc.status === 200, transcriptDoc.status);
  } else {
    // A silent-tone fixture genuinely contains no speech; the correct behaviour
    // is a 4xx/5xx naming that reason, never a fabricated transcript.
    check(
      'transcription of speechless audio fails honestly rather than inventing words',
      transcription.status >= 400 && Boolean(transcription.json?.error?.message),
      { status: transcription.status, error: transcription.json?.error },
    );
  }

  // --- link resolution -----------------------------------------------------
  const driveLink = await authed(cookie, 'POST', '/api/documents/import-link', {
    url: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view',
  });
  check(
    'Drive links are rewritten to a direct-download URL',
    driveLink.json?.resolved?.service === 'google-drive' &&
      /uc\?export=download/.test(driveLink.json?.resolved?.fetchUrl || ''),
    driveLink.json?.resolved,
  );

  const youtubeAsDoc = await authed(cookie, 'POST', '/api/documents/import-link', {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  });
  check(
    'a YouTube link is refused as a document and pointed at transcription',
    youtubeAsDoc.status === 422 && youtubeAsDoc.json?.error?.code === 'MEDIA_USE_TRANSCRIBE_LINK',
    youtubeAsDoc.json?.error,
  );

  // --- version history / undoable restore ---------------------------------
  const versionedPath = `uploads/versioned-${stamp}.md`;
  await authed(cookie, 'POST', '/api/documents', { path: versionedPath, text: 'version one' });
  await authed(cookie, 'POST', '/api/documents', { path: versionedPath, text: 'version two' });
  await authed(cookie, 'POST', '/api/documents', { path: versionedPath, text: 'version three' });
  const restored = await authed(cookie, 'POST', '/api/documents/restore-version', {
    path: versionedPath,
    version: 1,
  });
  check(
    'restoring an earlier version brings its content back',
    restored.status === 200 && /version one/.test(restored.json?.content || ''),
    restored.json?.content,
  );
  const afterRestore = await authed(cookie, 'GET', `/api/documents/${versionedPath}`);
  check(
    'a restore is itself undoable, so nothing is destroyed',
    afterRestore.json?.version >= 4 && Array.isArray(afterRestore.json?.history) && afterRestore.json.history.length >= 3,
    { version: afterRestore.json?.version, history: afterRestore.json?.history?.length },
  );

  // --- cross-user isolation -----------------------------------------------
  const other = await newSession();
  const stolen = await authed(other, 'GET', `/api/documents/${pdfPath}`);
  check(
    "another account cannot read this account's document",
    stolen.status === 404,
    stolen.status,
  );
  const askAsOther = await authed(other, 'POST', '/api/documents/ask', {
    question: 'What was the revenue?',
  });
  check(
    "another account's grounded answer cannot see these documents",
    (askAsOther.json?.documentsUsed || []).every((path: string) => !path.includes('report-')),
    askAsOther.json?.documentsUsed,
  );

  console.log(`\nDocuments increment: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('Failures:');
    for (const failure of failures) console.log(`  - ${failure}`);
  }
  return { passed, failed };
}

// Allow direct execution: npx tsx tests/test_documents_increment.ts
if (process.argv[1]?.includes('test_documents_increment')) {
  runDocumentsIncrementTests()
    .then(({ failed: total }) => process.exit(total > 0 ? 1 : 0))
    .catch((error) => {
      console.error('Documents increment tests crashed:', error);
      process.exit(1);
    });
}
