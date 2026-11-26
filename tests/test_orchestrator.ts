/**
 * Orchestrator tests — routing, task-aware selection, tool calling, evaluation
 * and fallback. These use fake providers registered into a real ProviderManager,
 * so the routing/fallback logic under test is the production code path.
 */

import assert from 'node:assert/strict';
import { ProviderManager } from '../src/engine/providers/factory.js';
import { ToolRegistry } from '../src/engine/tools/registry.js';
import { InMemoryStore } from '../src/engine/memory/in-memory.js';
import { networkManager } from '../src/engine/network/connection-manager.js';
import { RareOrchestrator, TASK_PROFILES } from '../src/engine/orchestrator/orchestrator.js';
import type { IModelProvider } from '../src/engine/providers/base.js';
import type {
  ModelGenerationConfig,
  ModelGenerationResult,
  ModelMessage,
  ModelProviderInfo,
  ModelProviderType,
} from '../src/engine/types.js';

function info(id: ModelProviderType, available: boolean): ModelProviderInfo {
  return {
    id,
    name: `fake-${id}`,
    modelIdentifier: `fake-${id}-model`,
    isAvailable: available,
    isConfigured: available,
    supportsFunctionCalling: true,
    supportsStreaming: false,
    license: 'test',
    freeTierStatus: { isFree: true, quotaNotes: 'test', rateLimitNotes: 'none' },
    statusMessage: available ? 'ready' : 'unavailable',
  };
}

class FakeProvider implements IModelProvider {
  public calls = 0;
  constructor(
    public readonly id: ModelProviderType,
    private readonly behaviour: 'ok' | 'throw' | 'bad-json' | 'tool-then-ok',
    private readonly reply = '{"tool":"finish","args":{"summary":"done"},"reasoning":"ok"}',
  ) {}
  public readonly name = 'fake';
  public readonly modelIdentifier = 'fake-model';

  async checkAvailability(): Promise<ModelProviderInfo> {
    return info(this.id, true);
  }

  async generate(
    _prompt: string | ModelMessage[],
    _config?: ModelGenerationConfig,
  ): Promise<ModelGenerationResult> {
    this.calls++;
    if (this.behaviour === 'throw') throw new Error('provider exploded');
    if (this.behaviour === 'bad-json') {
      return this.result('I cannot do that.');
    }
    if (this.behaviour === 'tool-then-ok') {
      if (this.calls === 1) {
        return {
          ...this.result('calling a tool'),
          toolCalls: [{ name: 'calculator_eval', args: { expression: '2+2' } }],
        };
      }
      return this.result('the answer is 4');
    }
    return this.result(this.reply);
  }

  private result(text: string): ModelGenerationResult {
    return {
      text,
      provider: this.id,
      model: this.modelIdentifier,
      latencyMs: 1,
      isSimulated: false,
      costEstimateUSD: 0,
    };
  }
}

/**
 * A provider that is registered but never available.
 *
 * Used to shadow the real providers ProviderManager installs in its
 * constructor, so a test can never accidentally reach a live model.
 */
class UnavailableProvider implements IModelProvider {
  public readonly name = 'unavailable';
  public readonly modelIdentifier = 'unavailable';
  constructor(public readonly id: ModelProviderType) {}
  async checkAvailability(): Promise<ModelProviderInfo> {
    return info(this.id, false);
  }
  async generate(): Promise<ModelGenerationResult> {
    throw new Error(`Provider "${this.id}" is not available in this test.`);
  }
}

function buildOrchestrator(providers: IModelProvider[]): RareOrchestrator {
  const manager = new ProviderManager();
  for (const provider of providers) manager.registerProvider(provider);

  // Make the test hermetic. ProviderManager's constructor registers the real
  // providers, and `resolveProviderForTask` marks Gemini eligible whenever
  // GEMINI_API_KEY is set and the network is online. Earlier tests in the suite
  // boot a server, which flips the network manager to ONLINE — so this test
  // would then route to the REAL Gemini provider and make a live API call
  // instead of using the fake. That is why it passed alone and failed in the
  // suite. Every provider id the orchestrator can select is now pinned to an
  // unavailable stub unless the test supplied its own.
  const supplied = new Set(providers.map((p) => p.id));
  for (const id of ['local-transformers', 'ollama', 'gemini', 'openai-compatible', 'diagnostic-mock'] as const) {
    if (!supplied.has(id)) manager.registerProvider(new UnavailableProvider(id));
  }

  const tools = new ToolRegistry();
  tools.register({
    name: 'calculator_eval',
    description: 'Evaluates arithmetic.',
    permissionLevel: 'READ_ONLY',
    parametersSchema: {
      type: 'object',
      properties: { expression: { type: 'string', description: 'expression' } },
      required: ['expression'],
    },
    execute: async (args) => ({
      success: true,
      output: { value: String(args.expression) === '2+2' ? 4 : null },
      durationMs: 1,
      permissionUsed: 'READ_ONLY',
      auditRecord: { timestamp: Date.now(), sanitizedArgs: args, permissionUsed: 'READ_ONLY' },
    }),
  });
  return new RareOrchestrator({
    providers: manager,
    tools,
    memory: new InMemoryStore(),
    networkManager,
    workspaceRoot: process.cwd(),
  });
}

export async function runOrchestratorTests(): Promise<void> {
  console.log('[Test Group] Orchestrator routing, tool calling and fallback');

  // 1. Task profiles exist for every capability the app routes through it.
  for (const kind of ['device_planning', 'chat', 'tool_execution', 'research', 'coding', 'diagnostic'] as const) {
    assert.ok(TASK_PROFILES[kind], `task profile "${kind}" must exist`);
  }
  assert.equal(TASK_PROFILES.device_planning.requiresFunctionCalling, true);
  assert.equal(TASK_PROFILES.device_planning.allowDiagnosticFallback, false);
  console.log('  ✓ task profiles declared');

  // 2. A healthy provider answers and is reported as the one that answered.
  {
    const local = new FakeProvider('local-transformers', 'ok');
    const orchestrator = buildOrchestrator([local]);
    const result = await orchestrator.run({
      taskKind: 'device_planning',
      messages: [{ role: 'user', content: 'do the thing' }],
    });
    assert.equal(result.provider, 'local-transformers');
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0].ok, true);
    console.log('  ✓ healthy provider answers and is named');
  }

  // 3. A failing provider falls back to the next available one.
  {
    const broken = new FakeProvider('local-transformers', 'throw');
    const backup = new FakeProvider('gemini', 'ok');
    const orchestrator = buildOrchestrator([broken, backup]);
    const result = await orchestrator.run({
      taskKind: 'device_planning',
      messages: [{ role: 'user', content: 'do the thing' }],
    });
    assert.equal(result.provider, 'gemini', 'must fall back to the next provider');
    assert.equal(result.attempts[0].ok, false);
    assert.equal(result.attempts[1].ok, true);
    console.log('  ✓ failing provider falls back');
  }

  // 4. Model evaluation rejects an unusable reply and triggers fallback.
  {
    const chatty = new FakeProvider('local-transformers', 'bad-json');
    const strict = new FakeProvider('gemini', 'ok');
    const orchestrator = buildOrchestrator([chatty, strict]);
    const result = await orchestrator.run({
      taskKind: 'device_planning',
      messages: [{ role: 'user', content: 'do the thing' }],
      validate: (text) => (text.trim().startsWith('{') ? null : 'not a JSON action'),
    });
    assert.equal(result.provider, 'gemini');
    assert.match(result.attempts[0].error || '', /Rejected by evaluation/);
    console.log('  ✓ evaluation rejects and falls back');
  }

  // 5. Tool calling: the model's tool call is executed and its real result fed back.
  {
    const toolUser = new FakeProvider('local-transformers', 'tool-then-ok');
    const orchestrator = buildOrchestrator([toolUser]);
    const result = await orchestrator.run({
      taskKind: 'tool_execution',
      messages: [{ role: 'user', content: 'what is 2+2?' }],
      tools: ['calculator_eval'],
    });
    assert.equal(result.toolExecutions.length, 1);
    assert.equal(result.toolExecutions[0].name, 'calculator_eval');
    assert.equal(result.toolExecutions[0].result.success, true);
    assert.equal(result.toolRounds, 1);
    assert.match(result.text, /4/);
    console.log('  ✓ tool call executed and result fed back');
  }

  // 6. When every provider fails, the orchestrator throws rather than inventing.
  {
    const a = new FakeProvider('local-transformers', 'throw');
    const b = new FakeProvider('gemini', 'throw');
    const orchestrator = buildOrchestrator([a, b]);
    let threw = false;
    try {
      await orchestrator.run({
        taskKind: 'device_planning',
        messages: [{ role: 'user', content: 'do the thing' }],
      });
    } catch (error: any) {
      threw = true;
      assert.match(error.message, /No model provider could complete/);
    }
    assert.equal(threw, true, 'must throw when no provider can answer');
    console.log('  ✓ total failure is reported, never faked');
  }

  // 7. Health reports real provider probes and both routing decisions.
  {
    const local = new FakeProvider('local-transformers', 'ok');
    const orchestrator = buildOrchestrator([local]);
    const health = await orchestrator.health();
    assert.ok(Array.isArray(health.providers));
    assert.ok(health.chatRoute.selectedProviderId);
    assert.ok(health.deviceRoute.selectedProviderId);
    assert.equal(health.zeroBudgetEnforced, true);
    console.log('  ✓ health reports providers and routing');
  }
}
