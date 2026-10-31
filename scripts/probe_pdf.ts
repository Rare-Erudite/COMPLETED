import { processUrl, processBuffer } from '../src/server/content/ContentEngine.js';
import { safeFetch } from '../src/server/content/SafeFetcher.js';
(async () => {
  // Real public PDF (W3C dummy / arXiv)
  for (const u of ['https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
                   'https://arxiv.org/pdf/1706.03762v7']) {
    const r = await processUrl(u, { maxBytes: 6*1024*1024 });
    console.log(u, '->', r.ok, r.kind, r.method, 'pages=', r.pages?.length, 'chars=', r.text.length);
    console.log('   sample:', JSON.stringify(r.text.slice(0, 160)));
    if (!r.ok) console.log('   err:', r.error);
  }
  // redirect chain
  const f = await safeFetch('https://httpbin.org/redirect/2').catch(e => ({ error: e.message } as any));
  console.log('REDIRECT:', (f as any).error || `${(f as any).status} chain=${JSON.stringify((f as any).redirectChain)}`);
})();
