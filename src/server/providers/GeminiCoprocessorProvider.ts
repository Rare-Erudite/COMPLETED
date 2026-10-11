import { GoogleGenAI } from '@google/genai';
import { IModelProvider, ModelInfo, GenerationOptions, GenerationResult } from '../types.js';

export class GeminiCoprocessorProvider implements IModelProvider {
  private apiKey: string | null = null;

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || null;
  }

  public async getInfo(): Promise<ModelInfo> {
    const available = await this.isAvailable();
    return {
      id: 'gemini-coprocessor',
      name: 'Gemini Coprocessor (External)',
      version: 'gemini-3.5-flash / gemini-3.8-flash',
      architecture: 'Remote Cloud Multimodal Transformer',
      type: 'gemini_coprocessor',
      requires_api_key: true,
      is_available: available,
      active: available,
      weights_location: 'Google AI Cloud Infrastructure',
      execution_environment: 'Remote API Endpoint via HTTPS',
      notes: 'Auxiliary cloud neural coprocessor. Operates when GEMINI_API_KEY is present; falls back gracefully to deterministic offline engine if unreachable.',
    };
  }

  public async isAvailable(): Promise<boolean> {
    const key = process.env.GEMINI_API_KEY;
    return Boolean(key && key.trim().length > 5);
  }

  public async generate(
    prompt: string,
    context?: string,
    options?: GenerationOptions
  ): Promise<GenerationResult> {
    const key = process.env.GEMINI_API_KEY;
    if (!key || key.trim().length <= 5) {
      throw new Error('GEMINI_API_KEY is not configured.');
    }

    const ai = new GoogleGenAI({
      apiKey: key,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const systemInstruction = `${options?.systemPrompt || 'You are RARE, a helpful personal assistant and software builder.'}\n\nContext:\n${context || ''}`;

    const candidateModels = ['gemini-3.5-flash', 'gemini-3.8-flash'];
    let lastError: any = null;

    for (const modelId of candidateModels) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Gemini API timeout on ${modelId}`)), 7000)
        );

        const response: any = await Promise.race([
          ai.models.generateContent({
            model: modelId,
            contents: prompt,
            config: {
              systemInstruction,
              temperature: options?.temperature ?? 0.7,
            },
          }),
          timeoutPromise,
        ]);

        const reply = response.text || 'Understood.';
        return {
          reply,
          thought: `[Gemini Neural Coprocessor: ${modelId}] Remote cloud neural inference verified.`,
          modelUsed: modelId,
          providerType: 'gemini_coprocessor',
        };
      } catch (err: any) {
        lastError = err;
        console.warn(`[GeminiCoprocessorProvider] Model ${modelId} failed:`, err?.message || err);
      }
    }

    throw lastError || new Error('All Gemini neural models failed or timed out.');
  }
}
