import { IModelProvider, ModelInfo, GenerationOptions, GenerationResult } from '../types.js';
import { engine } from '../../engine/engine.js';
import { LocalTransformersProvider } from '../../engine/providers/transformers-local.js';
import { buildRareSystemPrompt } from './RarePrompt.js';

export class LocalTransformersServerProvider implements IModelProvider {
  private getLocalProvider(): LocalTransformersProvider {
    return engine.providers.getProvider('local-transformers') as LocalTransformersProvider;
  }

  public async getInfo(): Promise<ModelInfo> {
    const local = this.getLocalProvider();
    const hasWeights = local.hasCachedWeights();
    const ready = local.isReady;

    return {
      id: 'local-transformers',
      name: 'Qwen 2.5 0.5B Instruct (Local Neural Model)',
      version: '2.5.0 (ONNX Q4)',
      architecture: 'Qwen2ForCausalLM (0.49B Parameters)',
      type: 'local_transformers',
      requires_api_key: false,
      is_available: hasWeights || ready,
      active: ready,
      weights_location: local.getCacheDir(),
      execution_environment: 'Local In-Process CPU Inference via ONNX Runtime',
      notes: ready
        ? 'Local neural model weights loaded in memory. Ready for genuine offline inference.'
        : hasWeights
        ? 'Local model weights verified on disk in durable user cache. Ready to load into memory.'
        : 'Model weights not yet downloaded. Call load-local or use Provider Hub to initialize.',
    };
  }

  public async isAvailable(): Promise<boolean> {
    const local = this.getLocalProvider();
    return local.hasCachedWeights() || local.isReady;
  }

  /** Starts loading (and, if needed, downloading) the model in the background. Never throws. */
  public preload(): void {
    try {
      const local = this.getLocalProvider();
      if (local.isReady) return;
      console.log('[LocalModel] Background load started (first run downloads ~786 MB).');
      local
        .loadModel()
        .then(() => console.log('[LocalModel] Qwen 2.5 0.5B is loaded and ready.'))
        .catch((err: any) => console.warn('[LocalModel] Background load failed:', err?.message || err));
    } catch (err: any) {
      console.warn('[LocalModel] Could not start background load:', err?.message || err);
    }
  }

  public async generate(
    prompt: string,
    context?: string,
    options?: GenerationOptions
  ): Promise<GenerationResult> {
    const local = this.getLocalProvider();
    if (!local.isReady) {
      if (local.hasCachedWeights()) {
        await local.loadModel();
      } else {
        throw new Error('LocalTransformersProvider: Model weights are not loaded. Run model initialization first.');
      }
    }

    const extra = (options || {}) as any;

    // 1. System prompt (+ only the few memories that matched this message).
    let system: string = options?.systemPrompt || buildRareSystemPrompt('RARE', extra.persona);
    const memoryLines: string[] = Array.isArray(extra.memoryContext) ? extra.memoryContext : [];
    if (memoryLines.length > 0) {
      system += `\n\nThings the user told you earlier (use them only if relevant):\n${memoryLines
        .map((m) => `- ${String(m).slice(0, 200)}`)
        .join('\n')}`;
    }

    // 2. Real chat turns, so the model uses its chat template instead of raw text.
    const messages: Array<{ role: string; content: string }> = [];
    const history: Array<{ role: string; content: string }> = Array.isArray(extra.history)
      ? extra.history
      : Array.isArray(options?.conversationHistory)
        ? options!.conversationHistory!
        : [];
    for (const turn of history) {
      if (!turn || !turn.content) continue;
      messages.push({ role: turn.role === 'assistant' ? 'model' : 'user', content: String(turn.content) });
    }
    // Fallback: if the caller sent no history, keep the old context block so nothing is lost.
    const finalUser = history.length === 0 && context ? `${context}\n\nUser: ${prompt}` : prompt;
    messages.push({ role: 'user', content: finalUser });

    const result = await local.generate(messages as any, {
      systemInstruction: system,
      temperature: options?.temperature ?? 0.7,
      maxOutputTokens: options?.maxTokens ?? 400,
    });

    return {
      reply: result.text,
      thought: `[Qwen2.5-0.5B-Instruct Neural Inference: ${result.latencyMs}ms, $0.00 cost, CPU execution]`,
      modelUsed: `local-transformers / ${local.manifest.name}`,
      providerType: 'local_transformers',
    };
  }
}
