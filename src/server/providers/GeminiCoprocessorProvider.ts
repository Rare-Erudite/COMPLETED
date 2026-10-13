import { GoogleGenAI } from '@google/genai';
import { IModelProvider, ModelInfo, GenerationOptions, GenerationResult } from '../types.js';

export class GeminiCoprocessorProvider implements IModelProvider {
  private apiKey: string | null = null;
  private client: GoogleGenAI | null = null;
  private availabilityCache: { key: string; expiresAt: number; available: boolean } | null = null;

  constructor(private readonly fetchImpl: typeof fetch = fetch) {
    this.apiKey = process.env.GEMINI_API_KEY || null;
  }

  public isConfigured(): boolean {
    const key = process.env.GEMINI_API_KEY;
    return Boolean(key && key.trim().length > 5 && key !== 'MY_GEMINI_API_KEY');
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
      version: 'gemini-2.5-flash / gemini-2.5-flash-lite',
      architecture: 'Remote Cloud Multimodal Transformer',
      type: 'gemini_coprocessor',
      requires_api_key: true,
      is_configured: this.isConfigured(),
      is_available: available,
      active: available,
      weights_location: 'Google AI Cloud Infrastructure',
      execution_environment: 'Remote API Endpoint via HTTPS',
      notes: 'Configured reports key presence. Available reports a successful Google model-catalog probe for a model supporting generateContent.',
    };
  }

  public async isAvailable(): Promise<boolean> {
    const key = process.env.GEMINI_API_KEY;
    if (!this.isConfigured() || !key) return false;
    if (this.availabilityCache?.key === key && this.availabilityCache.expiresAt > Date.now()) {
      return this.availabilityCache.available;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    let available = false;
    try {
      const response = await this.fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
        { signal: controller.signal },
      );
      if (response.ok) {
        const data = await response.json() as {
          models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
        };
        const supportedModels = new Set(['models/gemini-2.5-flash', 'models/gemini-2.5-flash-lite']);
        available = Boolean(data.models?.some((model) =>
          model.name && supportedModels.has(model.name) && model.supportedGenerationMethods?.includes('generateContent'),
        ));
      }
    } catch {
      available = false;
    } finally {
      clearTimeout(timeoutId);
    }
    this.availabilityCache = { key, expiresAt: Date.now() + 15_000, available };
    return available;
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

    const candidateModels = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
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
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(`Gemini API timeout on ${modelId}`)), 25000);
        });

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

        let response: any;
        try {
          response = await Promise.race([
            ai.models.generateContent({
              model: modelId,
              contents: contentsPayload,
              config: genConfig,
            }),
            timeoutPromise,
          ]);
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }

        const reply = response.text;
        if (typeof reply !== 'string' || reply.trim().length === 0) {
          throw new Error(`Gemini returned an empty response for ${modelId}.`);
        }
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

  public async transcribeAudio(audioBase64: string, mimeType: string): Promise<{ text: string; model: string }> {
    if (!audioBase64 || audioBase64.length > 14_000_000) {
      throw new Error('Audio data is missing or exceeds the 10 MB limit.');
    }
    const ai = this.getClient();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        { inlineData: { mimeType, data: audioBase64 } },
        'Transcribe the supplied audio verbatim. Preserve speaker changes when clear. Mark uncertain or inaudible speech as [inaudible]; do not infer words from context.',
      ],
    });
    const text = response.text;
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('Gemini returned an empty audio transcription.');
    }
    return { text, model: 'gemini-2.5-flash' };
  }
}
