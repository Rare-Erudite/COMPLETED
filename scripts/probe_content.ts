import fs from 'fs';
import { processBuffer, processUrl, chunkContent, describeResult } from '../src/server/content/ContentEngine.js';
import { sniffContent } from '../src/server/content/ContentSniffer.js';

async function main() {
  const docx = fs.readFileSync('/tmp/ct/sample.docx');
  const r1 = await processBuffer(docx, { filename: 'sample.docx' });
  console.log('DOCX ->', r1.ok, r1.kind, r1.method, JSON.stringify(r1.text.slice(0,120)));
  console.log('  describe:', describeResult(r1));

  const csv = Buffer.from('name,role,score\nAda,engineer,99\nGrace,admiral,98\n');
  const r2 = await processBuffer(csv, { filename: 'people.csv' });
  console.log('CSV ->', r2.ok, r2.kind, r2.method, JSON.stringify(r2.text.slice(0,100)));

  const html = Buffer.from('<html><head><title>Test Page</title></head><body><nav>menu</nav><h1>Heading One</h1><p>Body text about content engines.</p><script>evil()</script></body></html>');
  const r3 = await processBuffer(html, { filename: 'page.html' });
  console.log('HTML ->', r3.ok, r3.kind, r3.method, JSON.stringify(r3.text), 'title=', r3.metadata.title);

  const json = Buffer.from('{"a":1,"b":[2,3]}');
  const r4 = await processBuffer(json, { filename: 'data.json' });
  console.log('JSON ->', r4.ok, r4.kind, r4.method, JSON.stringify(r4.text.slice(0,60)));

  // mislabelled file: PDF bytes named .txt
  const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  const sniff = sniffContent(pdfBytes, 'notreally.txt', 'text/plain');
  console.log('MISLABEL ->', sniff.kind, '|', sniff.evidence);

  const chunks = chunkContent(r1);
  console.log('CHUNKS ->', chunks.length, chunks[0]?.text.slice(0,40));

  const url = await processUrl('https://example.com/');
  console.log('URL ->', url.ok, url.kind, url.method, 'final=', url.finalUrl, 'chars=', url.text.length);
  console.log('  text:', JSON.stringify(url.text.slice(0, 120)));

  const blocked = await processUrl('http://127.0.0.1:3000/api/documents');
  console.log('SSRF ->', blocked.ok, blocked.error?.code, blocked.error?.message);
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
