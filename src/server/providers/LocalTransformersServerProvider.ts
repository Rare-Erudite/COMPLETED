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
    const personaTone = options?.persona === 'professional'
      ? 'Use a rigorous, professional, technically precise tone.'
      : options?.persona === 'creative'
      ? 'Use an imaginative, expressive tone.'
      : options?.persona === 'concise'
      ? 'Be concise and direct.'
      : 'Be warm, natural, and conversational.';
    const systemContext = `${systemInstruction}\n${personaTone}${options?.thinkHarder ? ' Analyze the request carefully before composing the answer.' : ''}${context ? `\n\nRelevant user memory:\n${context}` : ''}`;
    const history = options?.conversationHistory || [];
    const messages = history.length > 0
      ? [
          ...history.map((message) => ({ role: message.role === 'assistant' ? 'model' as const : 'user' as const, content: message.content })),
          { role: 'user' as const, content: prompt },
        ]
      : null;

    const result = await local.generate(messages || (context
      ? `Relevant user memory:\n${context}\n\nUser Question:\n${prompt}`
      : prompt), {
      systemInstruction: systemContext,
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
