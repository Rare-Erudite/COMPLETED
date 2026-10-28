import { processUrl } from '../src/server/content/ContentEngine.js';
(async () => {
  const r = await processUrl('https://example.com/');
  console.log(JSON.stringify({ ok: r.ok, kind: r.kind, err: r.error, final: r.finalUrl, bytes: r.byteLength, attempts: r.attempts }, null, 2));
})();
