import assert from 'node:assert/strict';
import { MemoryStore } from '../src/server/storage/MemoryStore.js';
import { CheckpointStore } from '../src/server/storage/CheckpointStore.js';
import { ToolExecutor } from '../src/server/tools/ToolExecutor.js';
import { ProviderRegistry } from '../src/server/providers/ProviderRegistry.js';
import { RareIntelligenceProvider } from '../src/server/providers/RareIntelligenceProvider.js';

/**
 * Verifies the (optional) RARE-INTELLIGENCE engine bridge:
 *  1. Inert when RARE_INTELLIGENCE_URL is unset — existing offline behaviour preserved.
 *  2. Genuine bridged reply when the engine is configured and reachable (mocked transport).
 *  3. Graceful fallback to the offline engine when the bridge is configured but unreachable.
 */
export async function runRareIntelligenceBridgeTests() {
  console.log('--- Testing RARE-INTELLIGENCE Engine Bridge ---');

  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.RARE_INTELLIGENCE_URL;
  const originalKey = process.env.RARE_INTELLIGENCE_API_KEY;

  const memoryStore = new MemoryStore();
  const checkpointStore = new CheckpointStore();
  const toolExecutor = new ToolExecutor(memoryStore, checkpointStore);

  try {
    // 1. Unconfigured — provider must be inert and the registry must keep working offline.
    delete process.env.RARE_INTELLIGENCE_URL;
    delete process.env.RARE_INTELLIGENCE_API_KEY;

    const unconfigured = new RareIntelligenceProvider();
    assert.equal(unconfigured.isConfigured(), false, 'Provider must be inert without RARE_INTELLIGENCE_URL');
    assert.equal(await unconfigured.isAvailable(), false, 'Unconfigured provider must report unavailable');
    const unconfiguredOutcome = await unconfigured.generate('hi').then(() => 'resolved', () => 'threw');
    assert.equal(unconfiguredOutcome, 'threw', 'Unconfigured provider must throw so the fallback chain engages');

    const registryOff = new ProviderRegistry(memoryStore, toolExecutor);
    const offRes = await registryOff.generate('Hello there');
    assert.equal(offRes.providerType, 'offline_cognitive', 'Registry falls back to offline engine when bridge is unset');

    // 2. Configured + reachable (mocked engine) — genuine bridged reply, server-side key forwarded.
    process.env.RARE_INTELLIGENCE_URL = 'https://engine.example';
    process.env.RARE_INTELLIGENCE_API_KEY = 'test-engine-key';

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/engine/health')) {
        return new Response(
          JSON.stringify({
            success: true,
            health: {
              activeProvider: 'openai-compatible',
              operationalState: 'ONLINE',
              availableProviders: [{ id: 'openai-compatible', isAvailable: true, modelIdentifier: 'llama-local' }],
              operationalReport: { summaryMessage: 'Engine operational.' },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/api/v1/chat')) {
        assert.equal(
          (init?.headers as any)?.Authorization,
          'Bearer test-engine-key',
          'Engine API key must be forwarded server-side only',
        );
        return new Response(
          JSON.stringify({
            success: true,
            result: { text: 'Genuine bridged reply.', provider: 'openai-compatible', model: 'llama-local', latencyMs: 12, isSimulated: false },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const configured = new RareIntelligenceProvider();
    assert.equal(configured.isConfigured(), true);
    assert.equal(await configured.isAvailable(), true, 'Reachable engine must report available');
    const gen = await configured.generate('Explain the bridge', 'memory ctx', { systemPrompt: 'sys' });
    assert.equal(gen.providerType, 'rare_intelligence');
    assert.equal(gen.reply, 'Genuine bridged reply.');

    const registryOn = new ProviderRegistry(memoryStore, toolExecutor);
    const onRes = await registryOn.generate('Anything genuine?');
    assert.equal(onRes.providerType, 'rare_intelligence', 'Registry prefers the reachable bridge');

    // 3. Configured but unreachable — report unavailable and degrade gracefully.
    globalThis.fetch = (async () => {
      throw new TypeError('connection refused');
    }) as typeof fetch;

    const unreachable = new RareIntelligenceProvider();
    assert.equal(await unreachable.isAvailable(), false, 'Unreachable engine must report unavailable');
    const registryDown = new ProviderRegistry(memoryStore, toolExecutor);
    const downRes = await registryDown.generate('Still works without the engine?');
    assert.equal(downRes.providerType, 'offline_cognitive', 'Registry degrades gracefully when the bridge is down');
    assert.ok(downRes.reply.length > 10, 'Fallback still produces a usable reply');

    console.log('\u2713 RARE-INTELLIGENCE Engine Bridge tests passed.');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.RARE_INTELLIGENCE_URL;
    else process.env.RARE_INTELLIGENCE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.RARE_INTELLIGENCE_API_KEY;
    else process.env.RARE_INTELLIGENCE_API_KEY = originalKey;
  }
}
