/**
 * RARE-THE-SIXTH — RARE-INTELLIGENCE Bridge Provider
 *
 * Wraps the RARE-INTELLIGENCE engine (the companion repository) as a first-class
 * IModelProvider so RARE-THE-SIXTH can obtain genuine AI responses from the
 * intelligence engine over its versioned v1 REST API.
 *
 * Design guarantees:
 *  • Purely additive — the provider is only used when RARE_INTELLIGENCE_URL is set
 *    AND the engine answers. Otherwise isAvailable() is false and the registry keeps
 *    its existing Ollama → offline-cognitive behaviour unchanged.
 *  • Keys stay server-side. RARE-THE-SIXTH never forwards its own or the user's keys
 *    to the browser; it talks to the engine with an optional bearer token.
 *  • Failures are thrown, never swallowed, so ProviderRegistry.generate's existing
 *    fallback chain still catches them and degrades gracefully.
 */

import { IModelProvider, ModelInfo, GenerationOptions, GenerationResult } from '../types.js';

interface RareIntelligenceHealth {
  activeProvider?: string;
  operationalState?: string;
  availableProviders?: Array<{ id: string; isAvailable: boolean; isConfigured?: boolean; modelIdentifier?: string }>;
  operationalReport?: { summaryMessage?: string };
}

export class RareIntelligenceProvider implements IModelProvider {
  private baseUrl: string | null;
  private apiKey: string | null;
  private timeoutMs: number;

  constructor() {
    const url = process.env.RARE_INTELLIGENCE_URL?.trim();
    this.baseUrl = url ? url.replace(/\/+$/, '') : null;
    this.apiKey = process.env.RARE_INTELLIGENCE_API_KEY?.trim() || null;
    this.timeoutMs = Number(process.env.RARE_INTELLIGENCE_TIMEOUT_MS || 20000);
  }

  public isConfigured(): boolean {
    return Boolean(this.baseUrl);
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
      headers['X-API-Key'] = this.apiKey;
    }
    return headers;
  }

  private async fetchWithTimeout(path: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    try {
      return await fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal, headers: { ...this.headers(), ...(init.headers || {}) } });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Cheap reachability probe against the engine health endpoint. Never throws. */
  private async probeHealth(): Promise<RareIntelligenceHealth | null> {
    if (!this.baseUrl) return null;
    try {
      const res = await this.fetchWithTimeout('/api/v1/engine/health');
      if (!res.ok) return null;
      const json = (await res.json()) as { health?: RareIntelligenceHealth };
      return json.health || null;
    } catch {
      return null;
    }
  }

  public async isAvailable(): Promise<boolean> {
    return (await this.probeHealth()) !== null;
  }

  public async getInfo(): Promise<ModelInfo> {
    const health = await this.probeHealth();
    const available = health !== null;
    // The engine is reachable; is a real neural provider ready behind it?
    const activeId = health?.activeProvider;
    const activeEntry = health?.availableProviders?.find((p) => p.id === activeId);
    // Genuine when the engine is reachable and its ACTIVE provider is a real model
    // provider (not the deterministic diagnostic sandbox). We do not require the
    // health endpoint's live-probe flag, which is only set after an explicit probe.
    const realAiReady =
      available && !!activeId && activeId !== 'diagnostic-mock' && activeEntry?.isConfigured !== false;

    return {
      id: 'rare-intelligence',
      name: 'RARE-INTELLIGENCE Engine (Local/Free Bridge)',
      version: activeEntry?.modelIdentifier || 'v1 API',
      architecture: 'Decoupled intelligence engine (local open-weights, free-tier, or user-supplied key)',
      type: 'rare_intelligence',
      requires_api_key: false,
      is_available: available && realAiReady,
      active: available && realAiReady,
      weights_location: available
        ? `RARE-INTELLIGENCE engine at ${this.baseUrl}`
        : 'Not reachable (RARE_INTELLIGENCE_URL unset or engine offline)',
      execution_environment: available
        ? `Remote RARE-INTELLIGENCE process — provider "${activeId || 'unknown'}", state "${health?.operationalState || 'unknown'}"`
        : 'Engine unreachable',
      notes: available
        ? `${health?.operationalReport?.summaryMessage || 'Engine reachable.'} Zero-mandatory-cost: provide a free local model or a user-supplied key to the engine.`
        : 'Optional. Set RARE_INTELLIGENCE_URL to bridge in the RARE-INTELLIGENCE engine for genuine AI; without it RARE falls back to its own providers.',
    };
  }

  public async generate(
    prompt: string,
    context?: string,
    options?: GenerationOptions
  ): Promise<GenerationResult> {
    if (!this.baseUrl) {
      throw new Error('RareIntelligenceProvider: RARE_INTELLIGENCE_URL is not configured.');
    }

    const systemInstruction =
      `${options?.systemPrompt || 'You are RARE, a helpful personal assistant and software builder.'}` +
      (context ? `\n\nRelevant durable memory context:\n${context}` : '');

    const res = await this.fetchWithTimeout('/api/v1/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        options: {
          temperature: options?.temperature ?? 0.7,
          systemInstruction,
        },
      }),
    });

    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || json?.success === false) {
      const code = json?.error?.code || `HTTP ${res.status}`;
      const message = json?.error?.message || res.statusText || 'Unknown engine error';
      // Throwing (not swallowing) preserves ProviderRegistry's graceful fallback chain.
      throw new Error(`RareIntelligenceProvider: engine rejected the request [${code}]: ${message}`);
    }

    const result = json.result || {};
    const simulated = Boolean(result.isSimulated);
    const model = result.model || 'unknown';

    return {
      reply: result.text || '(the engine returned an empty response)',
      thought:
        `[RARE-INTELLIGENCE bridge → provider "${result.provider || 'n/a'}", model "${model}"` +
        `${simulated ? ' — SIMULATED (deterministic sandbox, not neural inference)' : ' — genuine inference'}, ` +
        `${result.latencyMs ?? '?'}ms, $0.00]`,
      modelUsed: `${result.provider || 'rare-intelligence'} / ${model}`,
      providerType: 'rare_intelligence',
    };
  }
}
