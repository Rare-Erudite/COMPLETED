import { IModelProvider, ModelInfo, GenerationOptions, GenerationResult } from '../types.js';

export class OllamaProvider implements IModelProvider {
  private baseUrl: string;
  private modelName: string;

  constructor(baseUrl = 'http://127.0.0.1:11434', modelName = 'qwen2.5-coder:7b') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.modelName = modelName;
  }

  public async getInfo(): Promise<ModelInfo> {
    const available = await this.isAvailable();
    return {
      id: 'local-ollama',
      name: `Ollama (${this.modelName})`,
      version: 'Local Daemon',
      architecture: 'Open-Weight Coder / Instruction Foundation Model',
      type: 'local_ollama',
      requires_api_key: false,
      is_available: available,
      active: available,
      weights_location: available ? `Local Ollama store (~/.ollama/models)` : 'Not installed locally',
      execution_environment: available ? 'Local GPU / CPU via Ollama runtime' : 'Daemon unreachable',
      notes: 'Selected model Qwen2.5-Coder 7B provides state-of-the-art coding and tool execution under Apache 2.0 license.',
    };
  }

  public async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return res.ok;
    } catch {
      return false;
    }
  }

  public async generate(
    prompt: string,
    context?: string,
    options?: GenerationOptions
  ): Promise<GenerationResult> {
    const available = await this.isAvailable();
    if (!available) {
      throw new Error(`Ollama daemon is not responding at ${this.baseUrl}`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s for local generation
    try {
      const systemPrompt = options?.systemPrompt || 'You are RARE, a helpful personal assistant and software builder.';
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          messages: [
            { role: 'system', content: `${systemPrompt}\n\nContext:\n${context || ''}` },
            { role: 'user', content: prompt },
          ],
          stream: false,
          options: {
            temperature: options?.temperature ?? 0.2,
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`Ollama generation failed: HTTP ${res.status}`);
      }

      const data: any = await res.json();
      const reply = data?.message?.content || data?.response || 'No response generated.';

      return {
        reply,
        thought: `[Local Neural Model: ${this.modelName}] Generated on local hardware via Ollama runtime.`,
        modelUsed: `Ollama (${this.modelName})`,
        providerType: 'local_ollama',
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      throw err;
    }
  }
}
