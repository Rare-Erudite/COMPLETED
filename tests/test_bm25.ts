import assert from 'node:assert/strict';
import { rankByBm25, rankMemoriesByBm25, idf, tokenize } from '../src/server/storage/bm25.js';

/**
 * BM25 retrieval tests.
 *
 * These lock in the behaviour that replaced the old substring-only memory
 * search: a natural-language query must find a memory that shares its terms
 * even when the whole query string never appears verbatim.
 */
export async function runBm25Tests(): Promise<void> {
  console.log('\n[bm25-retrieval]');

  assert.deepEqual(tokenize('Hello, World! 42'), ['hello', 'world', '42']);
  console.log('  ✓ tokenisation lowercases and splits on non-alphanumerics');

  assert.equal(idf(0, 0), 0);
  assert.ok(idf(10, 1) > idf(10, 9), 'a rarer term must carry more weight');
  assert.ok(idf(10, 9) > 0, 'idf must stay positive for a term in most documents');
  console.log('  ✓ idf is positive and rewards rarer terms');

  const docs = [
    { text: 'The user prefers VS Code as their editor' },
    { text: 'The user lives in Lagos' },
    { text: 'The user is building a mobile app' },
  ];
  const ranked = rankByBm25(docs, 'which editor does the user prefer');
  assert.ok(ranked.length >= 1, 'the query must match at least the editor memory');
  assert.equal(ranked[0].text, docs[0].text, 'the editor memory must rank first');
  console.log('  ✓ a natural-language query ranks the memory that shares its terms first');

  const memories = [
    { text: 'prefers dark mode', tags: ['ui'], kind: 'preference' },
    { text: 'works on the RARE project', tags: ['work'], kind: 'fact' },
  ];
  const byTag = rankMemoriesByBm25(memories, 'ui preference');
  assert.equal(byTag[0].text, 'prefers dark mode', 'tags and kind are indexed alongside the text');
  console.log('  ✓ tags and kind are indexed alongside the memory text');

  assert.deepEqual(rankByBm25(docs, 'zzzznomatch'), [], 'a query with no shared terms returns nothing');
  console.log('  ✓ a query with no shared terms returns nothing');
}
