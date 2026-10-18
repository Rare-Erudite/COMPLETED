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
  private lastUsed: { id: string; at: string; usedOfflineFallback: boolean; error?: string } | null = null;
  private lastLoggedProviderId = '';

  constructor(memoryStore: MemoryStore, toolExecutor: ToolExecutor) {
    this.offlineEngine = new OfflineCognitiveEngine(memoryStore, toolExecutor);
    this.localTransformersProvider = new LocalTransformersServerProvider();
    this.ollamaProvider = new OllamaProvider();
    this.geminiProvider = new GeminiCoprocessorProvider();
    // Optional bridge to the companion RARE-INTELLIGENCE engine. Inert unless
    // RARE_INTELLIGENCE_URL is configured AND the engine is reachable.
    this.rareIntelligenceProvider = new RareIntelligenceProvider();

    // Opt-in: set RARE_AUTOLOAD_LOCAL=1 to download/load the free local model at startup.
    if (process.env.RARE_AUTOLOAD_LOCAL === '1') {
      this.localTransformersProvider.preload();
    }
  }

  public setPreferredProvider(id: string): void {
    this.preferredProviderId = id;
  }

  public getPreferredProvider(): string {
    return this.preferredProviderId;
  }

  /** Which brain answered the most recent chat request (for status/debugging). */
  public getLastUsed() {
    return this.lastUsed;
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

    // 7. Last resort: rule-based offline engine (not a language model).
    return {
      provider: this.offlineEngine,
      info: await this.offlineEngine.getInfo(),
    };
  }

  /** Other genuine language models to try (in order) if the first choice errors out. */
  private async getRealFallbacks(exclude: IModelProvider): Promise<IModelProvider[]> {
    const out: IModelProvider[] = [];
    const candidates: IModelProvider[] = [
      this.geminiProvider,
      this.localTransformersProvider,
      this.ollamaProvider,
    ];
    for (const candidate of candidates) {
      if (candidate === exclude) continue;
      try {
        if (await candidate.isAvailable()) out.push(candidate);
      } catch {
        // ignore availability errors
      }
    }
    if (
      (this.rareIntelligenceProvider as IModelProvider) !== exclude &&
      this.rareIntelligenceProvider.isConfigured()
    ) {
      try {
        if (await this.rareIntelligenceProvider.isAvailable()) out.push(this.rareIntelligenceProvider);
      } catch {
        // ignore
      }
    }
    return out;
  }

  public async generate(
    prompt: string,
    context?: string,
    options?: GenerationOptions
  ): Promise<GenerationResult> {
    const { provider, info } = await this.getActiveProvider();

    if (this.lastLoggedProviderId !== info.id) {
      console.log(`[ProviderRegistry] Chat is now answered by: ${info.id} (${info.name})`);
      this.lastLoggedProviderId = info.id;
    }

    let firstError = '';
    try {
      const result = await provider.generate(prompt, context, options);
      this.lastUsed = { id: info.id, at: new Date().toISOString(), usedOfflineFallback: info.id === 'rare-offline-cognitive' };
      return result;
    } catch (err: any) {
      firstError = err?.message || String(err);
      console.error(`[ProviderRegistry] Provider "${info.id}" failed: ${firstError}`);
    }

    // Try any other real language model before giving up on genuine AI.
    for (const alt of await this.getRealFallbacks(provider)) {
      try {
        const result = await alt.generate(prompt, context, options);
        const altInfo = await alt.getInfo();
        console.warn(`[ProviderRegistry] Recovered using "${altInfo.id}" after "${info.id}" failed.`);
        this.lastUsed = { id: altInfo.id, at: new Date().toISOString(), usedOfflineFallback: false, error: firstError };
        return result;
      } catch (altErr: any) {
        console.error(`[ProviderRegistry] Fallback provider failed: ${altErr?.message || altErr}`);
      }
    }

    console.warn('[ProviderRegistry] No language model could answer. Using the rule-based offline engine.');
    const fallbackResult = await this.offlineEngine.generate(prompt, context, options);
    this.lastUsed = { id: 'rare-offline-cognitive', at: new Date().toISOString(), usedOfflineFallback: true, error: firstError };
    return {
      ...fallbackResult,
      thought: `[Primary provider failed (${firstError || 'Error'}); fell back to OfflineCognitiveEngine] ${fallbackResult.thought || ''}`.trim(),
      modelUsed: 'offline-cognitive-engine / RARE Native Cognitive Engine',
      providerType: 'offline_cognitive',
    };
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
