import assert from 'assert';
import { MemoryStore } from '../src/server/storage/MemoryStore.js';
import { CheckpointStore } from '../src/server/storage/CheckpointStore.js';
import { ToolExecutor } from '../src/server/tools/ToolExecutor.js';
import { OfflineCognitiveEngine } from '../src/server/providers/OfflineCognitiveEngine.js';
import { ProviderRegistry } from '../src/server/providers/ProviderRegistry.js';
import { GeminiCoprocessorProvider } from '../src/server/providers/GeminiCoprocessorProvider.js';
import { buildRareSystemPrompt } from '../src/server/providers/RarePrompt.js';
import { prepareConversationContext } from '../src/server/providers/ConversationContext.js';

export async function runModelProviderTests() {
  console.log('--- Testing Model Providers & Offline Intelligence ---');

  const memoryStore = new MemoryStore();
  const checkpointStore = new CheckpointStore();
  const toolExecutor = new ToolExecutor(memoryStore, checkpointStore);
  const offlineEngine = new OfflineCognitiveEngine(memoryStore, toolExecutor);
  const registry = new ProviderRegistry(memoryStore, toolExecutor);

  const originalGeminiKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  // The provider's supported-model set is env-driven (GEMINI_MODEL /
  // GEMINI_MODEL_LITE) because Google retires model ids. The mock must return
  // the model the provider is actually configured for, not a hardcoded id —
  // otherwise this test fails the day a model is retired, for the wrong reason.
  const configuredModel = process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash';
  const reachableGemini = new GeminiCoprocessorProvider(async () => new Response(JSON.stringify({
    models: [{ name: `models/${configuredModel}`, supportedGenerationMethods: ['generateContent'] }],
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
  const sharedPrompt = buildRareSystemPrompt('RARE');
  assert.match(sharedPrompt, /actual question first/i, 'The shared model prompt prioritizes the current request');
  assert.match(sharedPrompt, /avoid unrelated movie/i, 'The shared prompt discourages irrelevant entertainment references');
  assert.match(buildRareSystemPrompt('RARE', true), /without markdown or bullets/i, 'Voice guidance extends rather than replaces shared instructions');
  const preparedContext = prepareConversationContext(
    'Can you speak Igbo?',
    [
      ...Array.from({ length: 10 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `turn ${index}` })),
      { role: 'user', content: 'Can you speak Igbo?' },
    ],
    [
      { kind: 'preference', text: 'User is interested in the Igbo language.' },
      { kind: 'discussion', text: 'Unrelated favorite movie is The Example Film.' },
    ],
  );
  assert.equal(preparedContext.history.length, 8, 'Model context keeps only the latest eight prior turns');
  assert.equal(preparedContext.history.at(-1)?.content, 'turn 9', 'The current prompt is not duplicated in history');
  assert.match(preparedContext.memoryContext, /Igbo language/);
  assert.doesNotMatch(preparedContext.memoryContext, /Example Film/, 'Unrelated owner memories are not attached');

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
  const originalProviders = {
    local: registryInternals.localTransformersProvider,
    ollama: registryInternals.ollamaProvider,
    gemini: registryInternals.geminiProvider,
    rare: registryInternals.rareIntelligenceProvider,
  };
  const unavailableProvider = {
    isAvailable: async () => false,
    generate: async () => { throw new Error('must not run'); },
  };
  registryInternals.localTransformersProvider = unavailableProvider;
  registryInternals.ollamaProvider = unavailableProvider;
  registryInternals.geminiProvider = unavailableProvider;
  registryInternals.rareIntelligenceProvider = unavailableProvider;
  registryInternals.getActiveProvider = async () => ({ provider: registryInternals.offlineEngine });
  const memoryCountBeforeOnlineAttempt = memoryStore.getAll().length;
  await assert.rejects(
    registry.generateOnline('Remember that I live at 1 Example Street.'),
    (error: any) => error?.code === 'ONLINE_PROVIDER_UNAVAILABLE' && error?.statusCode === 503,
    'Online generation reports unavailability when only the offline engine exists',
  );
  assert.equal(memoryStore.getAll().length, memoryCountBeforeOnlineAttempt, 'Failed online generation must not trigger offline memory mutations');

  let firstAttempts = 0;
  let secondAttempts = 0;
  let receivedOptions: any;
  const brokenProvider = {
    isAvailable: async () => true,
    generate: async () => { firstAttempts += 1; throw new Error('credential=must-not-leak'); },
  };
  const workingProvider = {
    isAvailable: async () => true,
    generate: async (_prompt: string, _context: string | undefined, options: any) => {
      secondAttempts += 1;
      receivedOptions = options;
      return { reply: 'A model-backed answer.', modelUsed: 'test-model', providerType: 'gemini_coprocessor' };
    },
  };
  registryInternals.localTransformersProvider = brokenProvider;
  registryInternals.geminiProvider = workingProvider;
  registryInternals.ollamaProvider = unavailableProvider;
  registryInternals.rareIntelligenceProvider = unavailableProvider;
  registryInternals.getActiveProvider = async () => ({ provider: brokenProvider });
  const modelOptions = {
    conversationHistory: [{ role: 'user' as const, content: 'Earlier question' }, { role: 'assistant' as const, content: 'Earlier answer' }],
    thinkHarder: true,
    persona: 'concise',
  };
  const failoverResult = await registry.generateOnline('Answer this question', 'Relevant memory', modelOptions);
  assert.equal(failoverResult.reply, 'A model-backed answer.');
  assert.equal(firstAttempts, 1, 'The selected provider is attempted first and is not retried as a duplicate');
  assert.equal(secondAttempts, 1, 'A later available genuine provider is tried after failure');
  assert.equal(receivedOptions, modelOptions, 'Structured history and generation options reach the chosen provider');

  let emptyFallbackAttempts = 0;
  const emptyProvider = {
    isAvailable: async () => true,
    generate: async () => ({ reply: ' ', modelUsed: 'empty', providerType: 'gemini_coprocessor' }),
  };
  const offlineMarkedProvider = {
    isAvailable: async () => true,
    generate: async () => ({ reply: 'heuristic', modelUsed: 'fake', providerType: 'offline_cognitive' }),
  };
  const lastWorkingProvider = {
    isAvailable: async () => true,
    generate: async () => {
      emptyFallbackAttempts += 1;
      return { reply: 'Later provider answer.', modelUsed: 'test-model', providerType: 'local_ollama' };
    },
  };
  registryInternals.localTransformersProvider = emptyProvider;
  registryInternals.geminiProvider = offlineMarkedProvider;
  registryInternals.ollamaProvider = lastWorkingProvider;
  registryInternals.getActiveProvider = async () => ({ provider: emptyProvider });
  assert.equal((await registry.generateOnline('Another question')).reply, 'Later provider answer.');
  assert.equal(emptyFallbackAttempts, 1, 'Empty and offline-cognitive results are rejected and fail over');

  let terminalAttempts = 0;
  const terminalProvider = {
    isAvailable: async () => true,
    generate: async () => { terminalAttempts += 1; throw new Error('private-api-key=secret'); },
  };
  registryInternals.localTransformersProvider = terminalProvider;
  registryInternals.geminiProvider = terminalProvider;
  registryInternals.ollamaProvider = terminalProvider;
  registryInternals.rareIntelligenceProvider = terminalProvider;
  registryInternals.getActiveProvider = async () => ({ provider: terminalProvider });
  await assert.rejects(
    registry.generateOnline('No provider succeeds'),
    (error: any) => error?.code === 'ONLINE_PROVIDER_UNAVAILABLE' && error?.statusCode === 503 && !error.message.includes('secret'),
    'Exhausted genuine providers return a sanitized service-unavailable error',
  );
  assert.equal(terminalAttempts, 1, 'A repeated provider instance is attempted only once');

  registryInternals.localTransformersProvider = unavailableProvider;
  registryInternals.geminiProvider = unavailableProvider;
  registryInternals.ollamaProvider = unavailableProvider;
  registryInternals.rareIntelligenceProvider = unavailableProvider;
  registryInternals.getActiveProvider = originalActiveProvider;
  registryInternals.localTransformersProvider = originalProviders.local;
  registryInternals.ollamaProvider = originalProviders.ollama;
  registryInternals.geminiProvider = originalProviders.gemini;
  registryInternals.rareIntelligenceProvider = originalProviders.rare;

  if (originalKey) process.env.GEMINI_API_KEY = originalKey;

  console.log('✓ Model Providers & Offline Intelligence tests passed.');
}
