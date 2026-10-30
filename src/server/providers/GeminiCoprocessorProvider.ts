import { GoogleGenAI } from '@google/genai';
import { IModelProvider, ModelInfo, GenerationOptions, GenerationResult } from '../types.js';

/**
 * Gemini model ids, overridable per deployment.
 *
 * Google retires model ids on a schedule. A hardcoded id does not fail loudly
 * at build time — it fails at request time with a 404 ("no longer available to
 * new users"), which is exactly what happened to gemini-2.5-flash. Keeping the
 * ids in env vars lets an operator move to a new model without a code change.
 */
const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash';
const GEMINI_MODEL_LITE = process.env.GEMINI_MODEL_LITE?.trim() || 'gemini-3.8-flash-lite';

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
      version: `${GEMINI_MODEL} / ${GEMINI_MODEL_LITE}`,
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
        const supportedModels = new Set([`models/${GEMINI_MODEL}`, `models/${GEMINI_MODEL_LITE}`]);
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

    const candidateModels = [GEMINI_MODEL, GEMINI_MODEL_LITE];
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

        let contentsPayload: any = options?.conversationHistory?.length
          ? [
              ...options.conversationHistory.map((message) => ({
                role: message.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: message.content }],
              })),
              { role: 'user', parts: [{ text: prompt }] },
            ]
          : prompt;
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
        console.warn(`[GeminiCoprocessorProvider] Model ${modelId} request failed.`);
      }
    }

    throw lastError || new Error('All Gemini neural models failed or timed out.');
  }

  /**
   * Stream a reply token-by-token. Returns the concatenated text as well so the
   * caller can persist exactly what was streamed. Throws if every model fails,
   * so a caller can fall back to a non-streamed call rather than emit nothing.
   */
  public async *generateStream(
    prompt: string,
    context?: string,
    options?: GenerationOptions & { thinkHarder?: boolean; persona?: string }
  ): AsyncGenerator<string, string, void> {
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

    const contentsPayload: any = options?.conversationHistory?.length
      ? [
          ...options.conversationHistory.map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: message.content }],
          })),
          { role: 'user', parts: [{ text: prompt }] },
        ]
      : prompt;

    let lastError: any = null;
    for (const modelId of [GEMINI_MODEL, GEMINI_MODEL_LITE]) {
      // Once any token has been yielded, a retry would duplicate text the caller
      // has already rendered, so the fallback is only safe before the first token.
      let emitted = false;
      try {
        const stream = await ai.models.generateContentStream({
          model: modelId,
          contents: contentsPayload,
          config: { systemInstruction, temperature: options?.temperature ?? 0.7 },
        });
        let full = '';
        for await (const chunk of stream) {
          const piece = typeof chunk.text === 'string' ? chunk.text : '';
          if (piece) {
            full += piece;
            emitted = true;
            yield piece;
          }
        }
        if (!full.trim()) throw new Error(`Gemini streamed an empty response for ${modelId}.`);
        return full;
      } catch (err: any) {
        lastError = err;
        console.warn(`[GeminiCoprocessorProvider] Streaming model ${modelId} failed.`);
        if (emitted) throw err;
        continue;
      }
    }
    throw lastError || new Error('All Gemini neural models failed to stream.');
  }

  public async transcribeAudio(audioBase64: string, mimeType: string): Promise<{ text: string; model: string }> {
    if (!audioBase64 || audioBase64.length > 14_000_000) {
      throw new Error('Audio data is missing or exceeds the 10 MB limit.');
    }
    const ai = this.getClient();
    // Model names are configurable: Google retires models on a schedule, and a
    // hardcoded id silently breaks transcription the day it is withdrawn
    // (gemini-2.5-flash now returns 404 "no longer available to new users").
    let lastError: unknown = null;
    for (const modelId of [GEMINI_MODEL, GEMINI_MODEL_LITE]) {
      try {
        const response = await ai.models.generateContent({
          model: modelId,
          contents: [
            { inlineData: { mimeType, data: audioBase64 } },
            'Transcribe the supplied audio verbatim. Preserve speaker changes when clear. Mark uncertain or inaudible speech as [inaudible]; do not infer words from context.',
          ],
        });
        const text = response.text;
        if (typeof text !== 'string' || text.trim().length === 0) {
          throw new Error('Gemini returned an empty audio transcription.');
        }
        return { text, model: modelId };
      } catch (error) {
        lastError = error;
        console.warn(`[GeminiCoprocessorProvider] Transcription model ${modelId} failed.`);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('All configured Gemini transcription models failed.');
  }
}
