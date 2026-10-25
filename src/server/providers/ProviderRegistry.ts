import { IModelProvider, ModelInfo, GenerationOptions, GenerationResult } from '../types.js';
import { OfflineCognitiveEngine } from './OfflineCognitiveEngine.js';
import { OllamaProvider } from './OllamaProvider.js';
import { GeminiCoprocessorProvider } from './GeminiCoprocessorProvider.js';
import { RareIntelligenceProvider } from './RareIntelligenceProvider.js';
import { LocalTransformersServerProvider } from './LocalTransformersServerProvider.js';
import { MemoryStore } from '../storage/MemoryStore.js';
import { ToolExecutor } from '../tools/ToolExecutor.js';

export class ProviderRegistry {
  private offlineEngine: OfflineCognitiveEngine;
  private localTransformersProvider: LocalTransformersServerProvider;
  private ollamaProvider: OllamaProvider;
  private geminiProvider: GeminiCoprocessorProvider;
  private rareIntelligenceProvider: RareIntelligenceProvider;
  private preferredProviderId: string = 'local-transformers';

  constructor(memoryStore: MemoryStore, toolExecutor: ToolExecutor) {
    this.offlineEngine = new OfflineCognitiveEngine(memoryStore, toolExecutor);
    this.localTransformersProvider = new LocalTransformersServerProvider();
    this.ollamaProvider = new OllamaProvider();
    this.geminiProvider = new GeminiCoprocessorProvider();
    // Optional bridge to the companion RARE-INTELLIGENCE engine. Inert unless
    // RARE_INTELLIGENCE_URL is configured AND the engine is reachable, so it
    // never changes existing behaviour when unset.
    this.rareIntelligenceProvider = new RareIntelligenceProvider();
  }

  public setPreferredProvider(id: string): void {
    this.preferredProviderId = id;
  }

  public getPreferredProvider(): string {
    return this.preferredProviderId;
  }

  public async getAllProviders(): Promise<ModelInfo[]> {
    const list = await Promise.all([
      this.localTransformersProvider.getInfo(),
      this.offlineEngine.getInfo(),
      this.ollamaProvider.getInfo(),
      this.geminiProvider.getInfo(),
      this.rareIntelligenceProvider.getInfo(),
    ]);
    return list;
  }

  public async getActiveProvider(): Promise<{ provider: IModelProvider; info: ModelInfo }> {
    // 0. If local neural transformers model is preferred or available
    if (this.preferredProviderId === 'local-transformers' && (await this.localTransformersProvider.isAvailable())) {
      return {
        provider: this.localTransformersProvider,
        info: await this.localTransformersProvider.getInfo(),
      };
    }

    // 1. If user explicitly preferred local Ollama or Ollama is online and preferred
    if (this.preferredProviderId === 'local-ollama' && (await this.ollamaProvider.isAvailable())) {
      return {
        provider: this.ollamaProvider,
        info: await this.ollamaProvider.getInfo(),
      };
    }

    // 2. If user explicitly preferred Gemini coprocessor
    if (this.preferredProviderId === 'gemini-coprocessor' && (await this.geminiProvider.isAvailable())) {
      return {
        provider: this.geminiProvider,
        info: await this.geminiProvider.getInfo(),
      };
    }

    // 2b. Explicit preference for the RARE-INTELLIGENCE engine bridge
    if (this.preferredProviderId === 'rare-intelligence' && this.rareIntelligenceProvider.isConfigured() && (await this.rareIntelligenceProvider.isAvailable())) {
      return {
        provider: this.rareIntelligenceProvider,
        info: await this.rareIntelligenceProvider.getInfo(),
      };
    }

    // 3. Genuine Cloud AI inference via Gemini Coprocessor (when GEMINI_API_KEY is present)
    if (await this.geminiProvider.isAvailable()) {
      return {
        provider: this.geminiProvider,
        info: await this.geminiProvider.getInfo(),
      };
    }

    // 4. Check if local neural transformers model is available (has weights)
    if (await this.localTransformersProvider.isAvailable()) {
      return {
        provider: this.localTransformersProvider,
        info: await this.localTransformersProvider.getInfo(),
      };
    }

    // 5. Check if local Ollama daemon is detected and available
    if (await this.ollamaProvider.isAvailable()) {
      return {
        provider: this.ollamaProvider,
        info: await this.ollamaProvider.getInfo(),
      };
    }

    // 6. RARE-INTELLIGENCE engine bridge — used when configured and reachable
    if (this.rareIntelligenceProvider.isConfigured() && (await this.rareIntelligenceProvider.isAvailable())) {
      return {
        provider: this.rareIntelligenceProvider,
        info: await this.rareIntelligenceProvider.getInfo(),
      };
    }

    // 7. Default: RARE Native Offline Cognitive Engine (Zero External API Key required)
    return {
      provider: this.offlineEngine,
      info: await this.offlineEngine.getInfo(),
    };
  }

  public async generate(
    prompt: string,
    context?: string,
    options?: GenerationOptions
  ): Promise<GenerationResult> {
    // Attempt with active provider, with guaranteed fallback to offline engine
    const { provider } = await this.getActiveProvider();
    try {
      return await provider.generate(prompt, context, options);
    } catch (err: any) {
      // Keep the fallback available for explicitly offline callers, but never
      // log provider exception details that may contain URLs or credentials.
      console.warn('[ProviderRegistry] Configured provider failed; using the offline engine fallback.');
      const fallbackResult = await this.offlineEngine.generate(prompt, context, options);
      return {
        ...fallbackResult,
        thought: `[Online provider failed; fell back to OfflineCognitiveEngine] ${fallbackResult.thought || ''}`.trim(),
        modelUsed: 'offline-cognitive-engine / RARE Native Cognitive Engine',
        providerType: 'offline_cognitive',
      };
    }
  }

  /** Generate only from a real, reachable model provider. HTTP callers use this
   * to ensure a deterministic offline heuristic can never masquerade as AI. */
  public async generateOnline(
    prompt: string,
    context?: string,
    options?: GenerationOptions
  ): Promise<GenerationResult> {
    const active = await this.getActiveProvider();
    const preferred = this.preferredProviderId === 'gemini-coprocessor' ? this.geminiProvider
      : this.preferredProviderId === 'local-ollama' ? this.ollamaProvider
      : this.preferredProviderId === 'rare-intelligence' ? this.rareIntelligenceProvider
      : this.localTransformersProvider;
    const candidates = [
      active.provider,
      preferred,
      this.geminiProvider,
      this.localTransformersProvider,
      this.ollamaProvider,
      this.rareIntelligenceProvider,
    ].filter((provider, index, all) =>
      provider !== this.offlineEngine && all.indexOf(provider) === index,
    );

    for (const provider of candidates) {
      let available = provider === active.provider;
      if (!available) {
        try {
          available = await provider.isAvailable();
        } catch {
          available = false;
        }
      }
      if (!available) continue;

      try {
        const result = await provider.generate(prompt, context, options);
        if (result.providerType === 'offline_cognitive' || !result.reply?.trim()) {
          console.warn(`[ProviderRegistry] Online provider ${provider.constructor.name} returned no usable model response.`);
          continue;
        }
        return result;
      } catch {
        // Provider exceptions can contain request URLs or credentials. Keep the
        // log useful for operations without exposing error payloads or secrets.
        console.warn(`[ProviderRegistry] Online provider ${provider.constructor.name} failed; trying the next available provider.`);
      }
    }

    throw Object.assign(new Error('No online AI provider returned a usable response.'), {
      statusCode: 503,
      code: 'ONLINE_PROVIDER_UNAVAILABLE',
    });
  }

  public getOfflineEngine(): OfflineCognitiveEngine {
    return this.offlineEngine;
  }

  public getGeminiProvider(): GeminiCoprocessorProvider {
    return this.geminiProvider;
  }

  public getRareIntelligenceProvider(): RareIntelligenceProvider {
    return this.rareIntelligenceProvider;
  }
}
