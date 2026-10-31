import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DurableStateStore } from '../src/server/storage/DurableStateStore.js';
import { DocumentStore } from '../src/server/storage/DocumentStore.js';
import { PersistentJsonStore } from '../src/server/storage/PersistentJsonStore.js';
import { listProviders, providersFor } from '../src/server/services/ResearchProviders.js';

export async function runPersistentWorkflowTests() {
  console.log('--- Testing durable state, documents, and sourced research ---');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-workflows-'));
  const originalRoot = process.env.RARE_APP_ROOT;
  const originalFallback = process.env.RARE_ALLOW_LOCAL_STORAGE_FALLBACK;
  process.env.RARE_APP_ROOT = root;
  process.env.RARE_ALLOW_LOCAL_STORAGE_FALLBACK = 'true';
  try {
    // Explicit null isolates this suite from DATABASE_URL, including a developer's
    // or CI runner's configured production connection.
    const firstStore = new PersistentJsonStore(null);
    const firstState = new DurableStateStore();
    const firstValues = firstState.trackArray('test_values', ['initial']);
    await firstState.hydrate(firstStore);
    firstValues.push('persisted');
    await firstStore.flush();

    const secondStore = new PersistentJsonStore(null);
    const secondState = new DurableStateStore();
    const secondValues = secondState.trackArray('test_values', []);
    await secondState.hydrate(secondStore);
    assert.deepEqual([...secondValues], ['initial', 'persisted'], 'Durable state hydrates across store instances');
    assert.equal(secondStore.getStatus().mode, 'local-json', 'No database uses explicit local JSON persistence');

    const privateProject = {
      id: 'project-owner-a', ownerId: 'account-owner-a', title: 'Private project',
      targetDomain: 'web', objective: 'owner scoped', status: 'planning',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      agents: [], events: [], artifacts: [],
    };
    await firstStore.persistProjectRun(privateProject);
    assert.equal((await firstStore.getProjectRun('account-owner-b', privateProject.id)), null, 'Another owner cannot read a persisted project by ID');
    assert.deepEqual(await firstStore.listProjectRuns('account-owner-b'), [], 'Project lists are scoped by owner');
    await firstStore.setDeveloperCredential('account-owner-a', 'scrypt:owner-a:hash-a');
    assert.equal(await firstStore.getDeveloperCredential('account-owner-a'), 'scrypt:owner-a:hash-a');
    assert.equal(await firstStore.getDeveloperCredential('account-owner-b'), null, 'Developer credentials are scoped to their account');

    const passwordAccount = await firstStore.createAuthUser({
      id: 'account-owner-a', name: 'Owner A', email: 'owner-a@example.test', phone: null,
      passwordHash: null, provider: 'email', role: 'user', createdAt: new Date().toISOString(),
    });
    const unverifiedOAuth = await firstStore.upsertVerifiedOAuthUser({
      id: 'oauth-account-unverified', name: 'OAuth User', email: 'owner-a@example.test',
      emailVerified: false, provider: 'outlook', subject: 'tenant-a:subject-a', createdAt: new Date().toISOString(),
    });
    assert.notEqual(unverifiedOAuth.id, passwordAccount.id, 'An unverified email cannot link an OAuth identity to an existing account');
    assert.equal(unverifiedOAuth.email, null, 'An unverified provider email is not saved as the account email');
    const returningOAuth = await firstStore.upsertVerifiedOAuthUser({
      id: 'different-generated-id', name: 'OAuth User Updated', email: 'changed@example.test',
      emailVerified: false, provider: 'outlook', subject: 'tenant-a:subject-a', createdAt: new Date().toISOString(),
    });
    assert.equal(returningOAuth.id, unverifiedOAuth.id, 'OAuth identity uses the stable provider subject across email changes');
    const verifiedLink = await firstStore.upsertVerifiedOAuthUser({
      id: 'ignored-generated-id', name: 'Owner A', email: 'owner-a@example.test',
      emailVerified: true, provider: 'google', subject: 'google-subject-a', createdAt: new Date().toISOString(),
    });
    assert.equal(verifiedLink.id, passwordAccount.id, 'Only provider-verified email can link to an existing account');
    const restartedStore = new PersistentJsonStore(null);
    assert.equal((await restartedStore.getProjectRun('account-owner-a', privateProject.id))?.id, privateProject.id, 'Owned projects persist across storage restarts');
    await restartedStore.close();

    const documents = new DocumentStore(root);
    const written = documents.write('notes/source.txt', 'A real document body.');
    assert.equal(documents.read('notes/source.txt')?.content, 'A real document body.');
    assert.equal(written.size, Buffer.byteLength('A real document body.'));
    assert.equal(documents.convert(written.content, 'json'), JSON.stringify({ content: written.content }, null, 2));
    assert.throws(() => documents.read('../outside.txt'), /inside the documents folder/i);
    await assert.rejects(documents.importUrl('http://example.com/data.txt'), /public HTTPS/i);
    await assert.rejects(documents.importUrl('https://127.0.0.1/private.txt'), /Private and local/i);
    await assert.rejects(documents.importUrl('https://[::ffff:192.168.1.10]/private.txt'), /Private and local/i);

    // Research discovery is served by the provider registry, which the deep
    // engine and the RESEARCH tool both use. The old ResearchService queried
    // only Wikipedia and Crossref and has been removed; these assertions check
    // the registry that replaced it, including that it reports availability
    // honestly rather than listing sources it cannot reach.
    const providers = listProviders();
    assert.ok(providers.length >= 6, 'The registry exposes the full provider set');
    assert.ok(providers.some((provider) => provider.id === 'wikipedia'), 'Wikipedia is registered');
    assert.ok(providers.some((provider) => provider.id === 'crossref'), 'Crossref is registered');
    assert.ok(providers.some((provider) => provider.id === 'arxiv'), 'arXiv is registered');
    assert.ok(
      providers.every((provider) => typeof provider.available === 'boolean'),
      'Every provider reports availability as a real boolean, not a promise',
    );
    const academic = providersFor(['academic']);
    assert.ok(academic.length > 0, 'Academic category resolves to at least one provider');
    assert.ok(
      academic.every((provider) => provider.categories.includes('academic')),
      'Category filtering never returns a provider that cannot serve it',
    );

    await firstStore.close();
    await secondStore.close();
  } finally {
    if (originalRoot === undefined) delete process.env.RARE_APP_ROOT;
    else process.env.RARE_APP_ROOT = originalRoot;
    if (originalFallback === undefined) delete process.env.RARE_ALLOW_LOCAL_STORAGE_FALLBACK;
    else process.env.RARE_ALLOW_LOCAL_STORAGE_FALLBACK = originalFallback;
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('✓ Durable state, document safety, and real-source research tests passed.');
}
