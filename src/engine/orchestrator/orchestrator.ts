/**
 * RARE-INTELLIGENCE — Central Orchestrator
 *
 * The single intelligence entrypoint every RARE capability goes through. It is
 * deliberately NOT a model and NOT a provider: it owns the *architecture* around
 * whichever open-weight model or free inference endpoint is available.
 *
 * Responsibilities (each one is a real code path below, not a claim):
 *
 *   1. Model orchestration & routing — `selectCandidates()` asks the
 *      ProviderManager for a task-aware decision, then orders the remaining
 *      eligible providers as fallbacks.
 *   2. Selection by task & capability — `TASK_PROFILES` declares what each task
 *      kind needs (function calling, network, output budget, tool rounds).
 *   3. Tool calling & execution — `runToolRound()` executes the model's tool
 *      calls through the ToolRegistry (permission-checked, audited) and feeds
 *      the real results back into the conversation.
 *   4. Memory & context management — `buildMessages()` recalls relevant durable
 *      memory and bounds the context window.
 *   5. Planning & autonomous workflows — the tool loop is the plan→act→observe
 *      cycle; callers (e.g. the device planner) supply the observation each turn.
 *   6. Provider configuration & health checks — `health()` reports the real
 *      probe result of every registered provider.
 *   7. Model evaluation & fallback — `validate` rejects an unusable reply and
 *      the orchestrator moves to the next candidate; a per-provider circuit
 *      breaker stops it hammering a failing endpoint.
 *
 * Zero-budget policy: the orchestrator never selects a paid provider. The
 * ProviderManager only registers free/local/user-supplied-key providers, and
 * `diagnostic-mock` is excluded unless the caller explicitly allows it.
 */

import { IModelProvider } from '../providers/base.js';
import { ProviderManager } from '../providers/factory.js';
import { ToolRegistry } from '../tools/registry.js';
import { IMemoryStore } from '../memory/base.js';
import { CircuitBreaker } from '../errors/circuit-breaker.js';
import { NetworkTransitionManager } from '../network/connection-manager.js';
import { AppError } from '../errors/app-error.js';
import { logger } from '../security/logger.js';
import {
  ModelGenerationConfig,
  ModelGenerationResult,
  ModelMessage,
  ModelProviderInfo,
  ModelProviderType,
  ModelToolCall,
  ProviderSelectionDecision,
  TaskProviderRequirements,
  ToolExecutionResult,
} from '../types.js';

// ---------------------------------------------------------------------------
// Task profiles — what each kind of work needs from a model.
// ---------------------------------------------------------------------------

export type OrchestratorTaskKind =
  | 'device_planning'
  | 'chat'
  | 'tool_execution'
  | 'research'
  | 'coding'
  | 'diagnostic';

export interface OrchestratorTaskProfile {
  kind: OrchestratorTaskKind;
  /** The task needs the model to emit structured tool calls. */
  requiresFunctionCalling: boolean;
  /** The task needs an external network round-trip. */
  requiresNetwork: boolean;
  /** Provider class the task prefers when several are eligible. */
  preferredType?: 'local' | 'online' | 'deterministic' | 'diagnostic';
  temperature: number;
  maxOutputTokens: number;
  /** How many plan→act→observe rounds the tool loop may run. */
  maxToolRounds: number;
  /** Whether the deterministic sandbox may answer when nothing real is ready. */
  allowDiagnosticFallback: boolean;
}

export const TASK_PROFILES: Record<OrchestratorTaskKind, OrchestratorTaskProfile> = {
  // Device control: needs strict JSON/tool output, low temperature, short budget.
  device_planning: {
    kind: 'device_planning',
    requiresFunctionCalling: true,
    requiresNetwork: false,
    preferredType: 'local',
    temperature: 0.2,
    maxOutputTokens: 700,
    maxToolRounds: 1,
    allowDiagnosticFallback: false,
  },
  chat: {
    kind: 'chat',
    requiresFunctionCalling: false,
    requiresNetwork: false,
    temperature: 0.7,
    maxOutputTokens: 2048,
    maxToolRounds: 2,
    allowDiagnosticFallback: false,
  },
  tool_execution: {
    kind: 'tool_execution',
    requiresFunctionCalling: true,
    requiresNetwork: true,
    temperature: 0.2,
    maxOutputTokens: 1024,
    maxToolRounds: 4,
    allowDiagnosticFallback: false,
  },
  research: {
    kind: 'research',
    requiresFunctionCalling: true,
    requiresNetwork: true,
    preferredType: 'online',
    temperature: 0.4,
    maxOutputTokens: 2048,
    maxToolRounds: 3,
    allowDiagnosticFallback: false,
  },
  coding: {
    kind: 'coding',
    requiresFunctionCalling: true,
    requiresNetwork: false,
    temperature: 0.2,
    maxOutputTokens: 3072,
    maxToolRounds: 4,
    allowDiagnosticFallback: false,
  },
  diagnostic: {
    kind: 'diagnostic',
    requiresFunctionCalling: false,
    requiresNetwork: false,
    preferredType: 'diagnostic',
    temperature: 0,
    maxOutputTokens: 512,
    maxToolRounds: 0,
    allowDiagnosticFallback: true,
  },
};

// ---------------------------------------------------------------------------
// Request / result contracts
// ---------------------------------------------------------------------------

export interface OrchestratorRequest {
  taskKind: OrchestratorTaskKind;
  messages: ModelMessage[];
  systemInstruction?: string;
  /** Extra context (e.g. the current screen) appended to the system instruction. */
  context?: string;
  /** When set, relevant durable memory is recalled and injected as context. */
  memoryQuery?: string;
  /** 'auto' exposes every registered tool; an array exposes only those names. */
  tools?: 'auto' | string[];
  temperature?: number;
  maxOutputTokens?: number;
  maxToolRounds?: number;
  preferredType?: 'local' | 'online' | 'deterministic' | 'diagnostic';
  allowDiagnosticFallback?: boolean;
  /**
   * Model evaluation hook. Return an error string to reject the reply and make
   * the orchestrator fall back to the next provider; return null to accept it.
   */
  validate?: (text: string, result: ModelGenerationResult) => string | null;
}

export interface OrchestratorAttempt {
  provider: ModelProviderType;
  ok: boolean;
  error?: string;
  latencyMs?: number;
}

export interface OrchestratorToolExecution {
  name: string;
  args: Record<string, unknown>;
  result: ToolExecutionResult;
}

export interface OrchestratorResult {
  text: string;
  toolCalls?: ModelToolCall[];
  toolExecutions: OrchestratorToolExecution[];
  provider: ModelProviderType;
  model: string;
  latencyMs: number;
  isSimulated: boolean;
  routing: ProviderSelectionDecision;
  attempts: OrchestratorAttempt[];
  toolRounds: number;
  memoryUsed: number;
}

export interface OrchestratorHealth {
  taskProfiles: OrchestratorTaskKind[];
  providers: ModelProviderInfo[];
  /** The provider the orchestrator would pick for a plain chat right now. */
  chatRoute: ProviderSelectionDecision;
  /** The provider the orchestrator would pick for device planning right now. */
  deviceRoute: ProviderSelectionDecision;
  circuitStates: Array<{ provider: ModelProviderType; state: string }>;
  zeroBudgetEnforced: boolean;
}

export interface OrchestratorDeps {
  providers: ProviderManager;
  tools: ToolRegistry;
  memory: IMemoryStore;
  networkManager: NetworkTransitionManager;
  workspaceRoot: string;
  /** Shared breaker used for the whole engine; per-provider breakers are derived. */
  circuitBreaker?: CircuitBreaker;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class RareOrchestrator {
  private readonly providers: ProviderManager;
  private readonly tools: ToolRegistry;
  private readonly memory: IMemoryStore;
  private readonly networkManager: NetworkTransitionManager;
  private readonly workspaceRoot: string;
  private readonly breakers = new Map<ModelProviderType, CircuitBreaker>();

  constructor(deps: OrchestratorDeps) {
    this.providers = deps.providers;
    this.tools = deps.tools;
    this.memory = deps.memory;
    this.networkManager = deps.networkManager;
    this.workspaceRoot = deps.workspaceRoot;
  }

  // -- health ---------------------------------------------------------------

  /** Real probe of every registered provider plus the current routing decision. */
  public async health(): Promise<OrchestratorHealth> {
    const providers = await this.providers.getAvailableProvidersInfo();
    const chatRoute = await this.providers.resolveProviderForTask({
      preferredType: 'local',
      allowDiagnosticFallback: false,
    });
    const deviceRoute = await this.providers.resolveProviderForTask({
      preferredType: 'local',
      requiresFunctionCalling: true,
      allowDiagnosticFallback: false,
    });
    return {
      taskProfiles: Object.keys(TASK_PROFILES) as OrchestratorTaskKind[],
      providers,
      chatRoute,
      deviceRoute,
      circuitStates: Array.from(this.breakers.entries()).map(([provider, breaker]) => ({
        provider,
        state: breaker.getState(),
      })),
      zeroBudgetEnforced: true,
    };
  }

  // -- main entrypoint ------------------------------------------------------

  public async run(request: OrchestratorRequest): Promise<OrchestratorResult> {
    const profile = TASK_PROFILES[request.taskKind];
    if (!profile) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        message: `Unknown orchestrator task kind "${request.taskKind}".`,
        statusCode: 400,
      });
    }

    const started = Date.now();
    const { messages, memoryUsed } = await this.buildMessages(request, profile);
    const toolDeclarations = this.resolveTools(request.tools);
    const routing = await this.selectPrimary(profile, request);

    const candidates = await this.orderCandidates(routing, profile, request);
    const attempts: OrchestratorAttempt[] = [];
    const toolExecutions: OrchestratorToolExecution[] = [];

    let lastError = '';

    for (const provider of candidates) {
      const attemptStart = Date.now();
      try {
        const outcome = await this.runWithTools(provider, messages, {
          profile,
          request,
          toolDeclarations,
          toolExecutions,
        });

        // Model evaluation: a reply the caller cannot use is a failed attempt.
        const evaluated: ModelGenerationResult = {
          text: outcome.text,
          toolCalls: outcome.toolCalls,
          provider: provider.id,
          model: outcome.model,
          latencyMs: Date.now() - attemptStart,
          isSimulated: outcome.isSimulated,
          costEstimateUSD: 0,
        };
        const rejection = request.validate ? request.validate(outcome.text, evaluated) : null;
        if (rejection) {
          attempts.push({
            provider: provider.id,
            ok: false,
            error: `Rejected by evaluation: ${rejection}`,
            latencyMs: Date.now() - attemptStart,
          });
          lastError = rejection;
          logger.warn('Orchestrator', `Provider "${provider.id}" reply rejected: ${rejection}`);
          continue;
        }

        attempts.push({
          provider: provider.id,
          ok: true,
          latencyMs: Date.now() - attemptStart,
        });

        return {
          text: outcome.text,
          toolCalls: outcome.toolCalls,
          toolExecutions,
          provider: provider.id,
          model: outcome.model,
          latencyMs: Date.now() - started,
          isSimulated: outcome.isSimulated,
          routing,
          attempts,
          toolRounds: outcome.toolRounds,
          memoryUsed,
        };
      } catch (error: any) {
        const message = error?.message || String(error);
        lastError = message;
        attempts.push({
          provider: provider.id,
          ok: false,
          error: message,
          latencyMs: Date.now() - attemptStart,
        });
        // Never log the raw error payload: it can contain request URLs or keys.
        logger.warn('Orchestrator', `Provider "${provider.id}" failed; trying the next candidate.`);
      }
    }

    throw new AppError({
      code: 'PROVIDER_UNAVAILABLE',
      message:
        `No model provider could complete the "${request.taskKind}" task. ` +
        `Tried: ${attempts.map((a) => a.provider).join(', ') || 'none'}. ` +
        `Last error: ${lastError || 'unknown'}`,
      statusCode: 503,
      isTransient: true,
    });
  }

  // -- routing --------------------------------------------------------------

  private async selectPrimary(
    profile: OrchestratorTaskProfile,
    request: OrchestratorRequest,
  ): Promise<ProviderSelectionDecision> {
    const requirements: TaskProviderRequirements = {
      requiresNetwork: profile.requiresNetwork,
      requiresFunctionCalling: profile.requiresFunctionCalling,
      preferredType: request.preferredType ?? profile.preferredType,
      taskType: profile.kind === 'diagnostic' ? 'diagnostic' : 'inference',
      allowDiagnosticFallback:
        request.allowDiagnosticFallback ?? profile.allowDiagnosticFallback,
    };
    return this.providers.resolveProviderForTask(requirements);
  }

  /**
   * Builds the ordered candidate list: the routing decision first, then every
   * other provider that is genuinely available, ordered by the task profile.
   * The deterministic sandbox is only included when the caller allows it.
   */
  private async orderCandidates(
    routing: ProviderSelectionDecision,
    profile: OrchestratorTaskProfile,
    request: OrchestratorRequest,
  ): Promise<IModelProvider[]> {
    const allowDiagnostic =
      request.allowDiagnosticFallback ?? profile.allowDiagnosticFallback;

    const allIds: ModelProviderType[] = [
      'local-transformers',
      'ollama',
      'gemini',
      'openai-compatible',
      'diagnostic-mock',
    ];

    const available: IModelProvider[] = [];
    for (const id of allIds) {
      if (id === 'diagnostic-mock' && !allowDiagnostic) continue;
      let provider: IModelProvider;
      try {
        provider = this.providers.getProvider(id);
      } catch {
        continue;
      }
      try {
        const info = await provider.checkAvailability();
        if (info.isAvailable) {
          available.push(provider);
          continue;
        }
        // A local open-weight model whose weights are already on disk is not
        // "unavailable" — it is simply not loaded into memory yet. Load it now
        // so the orchestrator can actually use it. This never downloads a new
        // model and never trains anything; it only loads existing weights.
        if (id === 'local-transformers') {
          const local = provider as unknown as {
            hasCachedWeights?: () => boolean;
            loadModel?: () => Promise<boolean>;
          };
          if (typeof local.hasCachedWeights === 'function' && local.hasCachedWeights()) {
            try {
              if (typeof local.loadModel === 'function' && (await local.loadModel())) {
                available.push(provider);
                continue;
              }
            } catch {
              // Loading failed; treat it as unavailable and fall through.
            }
          }
        }
      } catch {
        // A probe failure means "not available", never "assume it works".
      }
    }

    const primary = available.find((p) => p.id === routing.selectedProviderId);
    const rest = available.filter((p) => p.id !== routing.selectedProviderId);

    // Order the fallbacks by what the task actually needs.
    const score = (provider: IModelProvider): number => {
      const isLocal = provider.id === 'local-transformers' || provider.id === 'ollama';
      const isOnline = provider.id === 'gemini' || provider.id === 'openai-compatible';
      if (profile.preferredType === 'online') return isOnline ? 0 : isLocal ? 1 : 2;
      if (profile.preferredType === 'local') return isLocal ? 0 : isOnline ? 1 : 2;
      if (profile.preferredType === 'diagnostic') return provider.id === 'diagnostic-mock' ? 0 : 1;
      return isLocal ? 0 : isOnline ? 1 : 2;
    };
    rest.sort((a, b) => score(a) - score(b));

    const ordered = primary ? [primary, ...rest] : rest;

    if (ordered.length === 0) {
      throw new AppError({
        code: 'PROVIDER_UNAVAILABLE',
        message:
          'No model provider is available. Install a local open-weight model, start Ollama, ' +
          'or configure a free inference endpoint.',
        statusCode: 503,
        isTransient: true,
      });
    }
    return ordered;
  }

  // -- context & memory -----------------------------------------------------

  private async buildMessages(
    request: OrchestratorRequest,
    profile: OrchestratorTaskProfile,
  ): Promise<{ messages: ModelMessage[]; memoryUsed: number }> {
    const parts: string[] = [];
    if (request.systemInstruction) parts.push(request.systemInstruction);
    if (request.context) parts.push(request.context);

    let memoryUsed = 0;
    if (request.memoryQuery) {
      try {
        const recalled = await this.memory.search(request.memoryQuery);
        const top = recalled.slice(0, 5);
        if (top.length > 0) {
          memoryUsed = top.length;
          parts.push(
            'Relevant durable memory:\n' +
              top.map((item) => `- ${item.content}`).join('\n'),
          );
        }
      } catch {
        // Memory is an enhancement, never a hard dependency.
      }
    }

    const messages: ModelMessage[] = [];
    if (parts.length > 0) {
      messages.push({ role: 'system', content: parts.join('\n\n') });
    }
    // Bound the context window so a long history cannot blow the model's limit.
    const history = request.messages.slice(-20);
    messages.push(...history);

    // Touch the profile so the compiler keeps the contract explicit.
    void profile;
    return { messages, memoryUsed };
  }

  private resolveTools(selection: OrchestratorRequest['tools']) {
    if (selection === undefined || selection === 'auto') {
      return this.tools.getDeclarationsForModel();
    }
    if (Array.isArray(selection)) {
      const wanted = new Set(selection);
      return this.tools
        .getDeclarationsForModel()
        .filter((declaration) => wanted.has(declaration.name));
    }
    return [];
  }

  // -- generation + tool loop ----------------------------------------------

  private breakerFor(provider: ModelProviderType): CircuitBreaker {
    let breaker = this.breakers.get(provider);
    if (!breaker) {
      breaker = new CircuitBreaker({
        failureThreshold: 3,
        resetTimeoutMs: 30000,
        name: `orchestrator-${provider}`,
      });
      this.breakers.set(provider, breaker);
    }
    return breaker;
  }

  private async runWithTools(
    provider: IModelProvider,
    baseMessages: ModelMessage[],
    ctx: {
      profile: OrchestratorTaskProfile;
      request: OrchestratorRequest;
      toolDeclarations: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
      toolExecutions: OrchestratorToolExecution[];
    },
  ): Promise<{
    text: string;
    toolCalls?: ModelToolCall[];
    model: string;
    isSimulated: boolean;
    toolRounds: number;
  }> {
    const { profile, request, toolDeclarations, toolExecutions } = ctx;
    const maxRounds = request.maxToolRounds ?? profile.maxToolRounds;
    const messages = [...baseMessages];
    let rounds = 0;
    let last: ModelGenerationResult | null = null;

    for (let round = 0; round <= maxRounds; round++) {
      const config: ModelGenerationConfig = {
        temperature: request.temperature ?? profile.temperature,
        maxOutputTokens: request.maxOutputTokens ?? profile.maxOutputTokens,
        tools: toolDeclarations.length > 0 ? toolDeclarations : undefined,
      };

      const result = await this.breakerFor(provider.id).execute(() =>
        provider.generate(messages, config),
      );
      last = result;

      const calls = result.toolCalls ?? [];
      if (calls.length === 0 || round === maxRounds) {
        return {
          text: result.text,
          toolCalls: calls.length > 0 ? calls : undefined,
          model: result.model,
          isSimulated: result.isSimulated,
          toolRounds: rounds,
        };
      }

      // Plan → act: execute every tool the model asked for, then observe.
      rounds++;
      messages.push({ role: 'model', content: result.text || '' });
      for (const call of calls) {
        const execution = await this.tools.execute(call.name, call.args, {
          workspaceRoot: this.workspaceRoot,
          permissionGrant: ['READ_ONLY', 'WORKSPACE_WRITE', 'NETWORK_ACCESS'],
        });
        toolExecutions.push({ name: call.name, args: call.args, result: execution });
        messages.push({
          role: 'user',
          content:
            `Tool "${call.name}" result: ` +
            (execution.success
              ? JSON.stringify(execution.output).slice(0, 4000)
              : `FAILED — ${execution.error || 'unknown error'}`),
        });
      }
    }

    return {
      text: last?.text || '',
      model: last?.model || provider.modelIdentifier,
      isSimulated: last?.isSimulated ?? false,
      toolRounds: rounds,
    };
  }
}
