import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DurableStateStore } from '../src/server/storage/DurableStateStore.js';
import { DocumentStore } from '../src/server/storage/DocumentStore.js';
import { PersistentJsonStore } from '../src/server/storage/PersistentJsonStore.js';
import { ResearchService } from '../src/server/services/ResearchService.js';

export async function runPersistentWorkflowTests() {
  console.log('--- Testing durable state, documents, and sourced research ---');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-workflows-'));
  const originalRoot = process.env.RARE_APP_ROOT;
  process.env.RARE_APP_ROOT = root;
  try {
    const firstStore = new PersistentJsonStore(undefined);
    const firstState = new DurableStateStore();
    const firstValues = firstState.trackArray('test_values', ['initial']);
    await firstState.hydrate(firstStore);
    firstValues.push('persisted');
    await firstStore.flush();

    const secondStore = new PersistentJsonStore(undefined);
    const secondState = new DurableStateStore();
    const secondValues = secondState.trackArray('test_values', []);
    await secondState.hydrate(secondStore);
    assert.deepEqual([...secondValues], ['initial', 'persisted'], 'Durable state hydrates across store instances');
    assert.equal(secondStore.getStatus().mode, 'local-json', 'No database uses explicit local JSON persistence');

    const documents = new DocumentStore(root);
    const written = documents.write('notes/source.txt', 'A real document body.');
    assert.equal(documents.read('notes/source.txt')?.content, 'A real document body.');
    assert.equal(written.size, Buffer.byteLength('A real document body.'));
    assert.equal(documents.convert(written.content, 'json'), JSON.stringify({ content: written.content }, null, 2));
    assert.throws(() => documents.read('../outside.txt'), /inside the documents folder/i);

    const research = new ResearchService(async (input) => {
      const url = String(input);
      if (url.includes('wikipedia.org')) {
        return new Response(JSON.stringify({ query: { search: [{ title: 'Example topic', pageid: 42, timestamp: '2026-01-01', snippet: 'Source &amp; excerpt' }] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: { items: [{ title: ['Research paper'], URL: 'https://doi.org/10.1000/example', DOI: '10.1000/example', publisher: 'Example Press', created: { 'date-parts': [[2025, 1, 2]] } }] } }), { status: 200 });
    });
    const result = await research.search('example topic', 5);
    assert.equal(result.totalHits, 2);
    assert.equal(result.findings[0].source, 'Wikipedia');
    assert.equal(result.findings[0].snippet, 'Source & excerpt');
    assert.ok(result.findings.some((finding) => finding.source === 'Crossref'));
    assert.deepEqual(result.sourceErrors, []);

    await firstStore.close();
    await secondStore.close();
  } finally {
    if (originalRoot === undefined) delete process.env.RARE_APP_ROOT;
    else process.env.RARE_APP_ROOT = originalRoot;
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('✓ Durable state, document safety, and real-source research tests passed.');
}