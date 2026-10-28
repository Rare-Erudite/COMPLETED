import fs from 'fs';
import { processBuffer } from '../src/server/content/ContentEngine.js';
(async () => {
  const img = await processBuffer(fs.readFileSync('/tmp/ct/scan.png'), { filename: 'scan.png' });
  console.log('IMAGE OCR ->', img.ok, img.kind, img.method, 'ocr=', img.ocr);
  console.log('   text:', JSON.stringify(img.text.slice(0, 200)));

  const pdf = await processBuffer(fs.readFileSync('/tmp/ct/scanned.pdf'), { filename: 'scanned.pdf' });
  console.log('SCANNED PDF ->', pdf.ok, pdf.kind, pdf.method, 'ocr=', pdf.ocr, 'pages=', pdf.pages?.length);
  console.log('   text:', JSON.stringify(pdf.text.slice(0, 200)));
  console.log('   attempts:', pdf.attempts.map(a => `${a.extractor}:${a.ok ? 'ok' : a.error}`).join(' | '));
})();
