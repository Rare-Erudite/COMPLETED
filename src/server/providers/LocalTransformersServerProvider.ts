import { IModelProvider, ModelInfo, GenerationOptions, GenerationResult } from '../types.js';
import { engine } from '../../engine/engine.js';
import { LocalTransformersProvider } from '../../engine/providers/transformers-local.js';

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

    const systemInstruction = options?.systemPrompt || 'You are RARE-INTELLIGENCE, a helpful AI assistant.';
    const formattedPrompt = context
      ? `System Context:\n${context}\n\nUser Question:\n${prompt}`
      : prompt;

    const result = await local.generate(formattedPrompt, {
      systemInstruction,
      temperature: options?.temperature ?? 0.7,
      maxOutputTokens: options?.maxTokens ?? 256,
    });

    return {
      reply: result.text,
      thought: `[Qwen2.5-0.5B-Instruct Neural Inference: ${result.latencyMs}ms, $0.00 cost, CPU execution]`,
      modelUsed: `local-transformers / ${local.manifest.name}`,
      providerType: 'local_transformers',
    };
  }
}
