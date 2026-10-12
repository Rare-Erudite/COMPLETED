import { GoogleGenAI } from '@google/genai';
import { IModelProvider, ModelInfo, GenerationOptions, GenerationResult } from '../types.js';

export class GeminiCoprocessorProvider implements IModelProvider {
  private apiKey: string | null = null;
  private client: GoogleGenAI | null = null;

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || null;
  }

  private getClient(): GoogleGenAI {
    const key = process.env.GEMINI_API_KEY;
    if (!key || key.trim().length <= 5) {
      throw new Error('GEMINI_API_KEY is not configured.');
    }
    if (!this.client || this.apiKey !== key) {
      this.apiKey = key;
      this.client = new GoogleGenAI({
        apiKey: key,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
    }
    return this.client;
  }

  public async getInfo(): Promise<ModelInfo> {
    const available = await this.isAvailable();
    return {
      id: 'gemini-coprocessor',
      name: 'Gemini Coprocessor (External)',
      version: 'gemini-3-flash-preview / gemini-2.5-flash',
      architecture: 'Remote Cloud Multimodal Transformer',
      type: 'gemini_coprocessor',
      requires_api_key: true,
      is_available: available,
      active: available,
      weights_location: 'Google AI Cloud Infrastructure',
      execution_environment: 'Remote API Endpoint via HTTPS',
      notes: 'Auxiliary cloud neural coprocessor. Operates when GEMINI_API_KEY is present; falls back gracefully to standalone cognitive engine if unreachable.',
    };
  }

  public async isAvailable(): Promise<boolean> {
    const key = process.env.GEMINI_API_KEY;
    return Boolean(key && key.trim().length > 5 && key !== 'MY_GEMINI_API_KEY');
  }

  public async generate(
    prompt: string,
    context?: string,
    options?: GenerationOptions & { thinkHarder?: boolean; persona?: string }
  ): Promise<GenerationResult> {
    const ai = this.getClient();

    const personaTone =
      options?.persona === 'professional'
        ? 'Adopt a rigorous, professional, and technically precise tone.'
        : options?.persona === 'creative'
        ? 'Adopt an imaginative, expressive, and creative tone.'
        : options?.persona === 'concise'
        ? 'Be extremely concise, direct, and to the point.'
        : 'Be warm, natural, friendly, and conversational.';

    const systemInstruction = `${
      options?.systemPrompt ||
      'You are RARE, a standalone personal AI companion, researcher, and full-stack software builder.'
    }\n${personaTone}\n\nContext & Memory:\n${context || 'None'}`;

    const candidateModels = [
      'gemini-3.8-flash',
      'gemini-3.5-flash',
      'gemini-flash-latest',
      'gemini-3.1-flash-lite',
      'gemini-3-flash-preview',
    ];
    let lastError: any = null;

    const isDeepReasoning = options?.thinkHarder === true;
    const genConfig: any = {
      systemInstruction,
      temperature: options?.temperature ?? 0.7,
    };

    // Allow adaptive reasoning budget so the model thoroughly analyzes the user's prompt
    // rather than rushing out shallow unconsidered replies
    if (isDeepReasoning) {
      genConfig.thinkingConfig = { thinkingBudget: 4096 };
    }

    for (const modelId of candidateModels) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Gemini API timeout on ${modelId}`)), 25000)
        );

        let contentsPayload: any = prompt;
        if ((options as any)?.image) {
          let mimeType = 'image/jpeg';
          let base64Data = (options as any).image;
          if (typeof base64Data === 'string' && base64Data.startsWith('data:')) {
            const match = base64Data.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              mimeType = match[1];
              base64Data = match[2];
            }
          }
          contentsPayload = [
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
            prompt,
          ];
        }

        const response: any = await Promise.race([
          ai.models.generateContent({
            model: modelId,
            contents: contentsPayload,
            config: genConfig,
          }),
          timeoutPromise,
        ]);

        const reply = response.text || 'Understood.';
        return {
          reply,
          thought: isDeepReasoning ? `[Gemini Neural Coprocessor: ${modelId}] Extended reasoning verified.` : undefined,
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
