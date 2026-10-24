import assert from 'assert';
import { MemoryStore } from '../src/server/storage/MemoryStore.js';
import { CheckpointStore } from '../src/server/storage/CheckpointStore.js';
import { ToolExecutor } from '../src/server/tools/ToolExecutor.js';
import { OfflineCognitiveEngine } from '../src/server/providers/OfflineCognitiveEngine.js';
import { ProviderRegistry } from '../src/server/providers/ProviderRegistry.js';
import { GeminiCoprocessorProvider } from '../src/server/providers/GeminiCoprocessorProvider.js';

export async function runModelProviderTests() {
  console.log('--- Testing Model Providers & Offline Intelligence ---');

  const memoryStore = new MemoryStore();
  const checkpointStore = new CheckpointStore();
  const toolExecutor = new ToolExecutor(memoryStore, checkpointStore);
  const offlineEngine = new OfflineCognitiveEngine(memoryStore, toolExecutor);
  const registry = new ProviderRegistry(memoryStore, toolExecutor);

  const originalGeminiKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  const reachableGemini = new GeminiCoprocessorProvider(async () => new Response(JSON.stringify({
    models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }],
  }), { status: 200 }));
  assert.equal(await reachableGemini.isAvailable(), true, 'Gemini is reachable only when a supported model is returned');
  assert.equal((await reachableGemini.getInfo()).is_configured, true, 'Gemini info distinguishes key configuration');

  const unavailableGemini = new GeminiCoprocessorProvider(async () => new Response('forbidden', { status: 403 }));
  assert.equal(await unavailableGemini.isAvailable(), false, 'Invalid credentials do not report Gemini as available');
  if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalGeminiKey;

  // 1. Verify Offline Cognitive Engine reports genuine metadata (no fake weights)
  const info = await offlineEngine.getInfo();
  assert.strictEqual(info.requires_api_key, false, 'Offline engine must not require an API key');
  assert.strictEqual(info.type, 'offline_cognitive', 'Provider type must be offline_cognitive');
  assert.ok(info.weights_location.includes('No Neural Weight Files'), 'Accurately documents weight absence');

  // 2. Test ordinary conversation without API key
  const greetingRes = await offlineEngine.generate('Hello RARE!');
  assert.ok(greetingRes.reply.length > 10, 'Expected non-empty conversational reply');
  assert.strictEqual(greetingRes.providerType, 'offline_cognitive', 'Expected offline_cognitive provider type');

  // 3. Test memory recall query (shoe discussion recall)
  const shoeRes = await offlineEngine.generate('What were we discussing about shoes?');
  assert.ok(
    shoeRes.reply.toLowerCase().includes('shoe') || shoeRes.reply.toLowerCase().includes('sneaker'),
    'Expected memory retrieval about shoes'
  );

  // 4. Test provider registry fallback
  // Temporarily unset GEMINI_API_KEY if present
  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  const regRes = await registry.generate('Can you help me design an offline dashboard?');
  assert.ok(regRes.reply.length > 10, 'Registry generated response without GEMINI_API_KEY');
  assert.strictEqual(regRes.providerType, 'offline_cognitive', 'Registry fell back to offline engine');

  // HTTP-facing online generation must fail closed rather than run the
  // heuristic engine or its global memory/tool side effects.
  const registryInternals = registry as any;
  const originalActiveProvider = registryInternals.getActiveProvider;
  registryInternals.getActiveProvider = async () => ({ provider: registryInternals.offlineEngine });
  const memoryCountBeforeOnlineAttempt = memoryStore.getAll().length;
  await assert.rejects(
    registry.generateOnline('Remember that I live at 1 Example Street.'),
    (error: any) => error?.code === 'ONLINE_PROVIDER_UNAVAILABLE' && error?.statusCode === 503,
    'Online generation reports unavailability when only the offline engine exists',
  );
  assert.equal(memoryStore.getAll().length, memoryCountBeforeOnlineAttempt, 'Failed online generation must not trigger offline memory mutations');
  registryInternals.getActiveProvider = originalActiveProvider;

  if (originalKey) process.env.GEMINI_API_KEY = originalKey;

  console.log('✓ Model Providers & Offline Intelligence tests passed.');
}
