import { GoogleGenAI } from '@google/genai';
import { IModelProvider, ModelInfo, GenerationOptions, GenerationResult } from '../types.js';
import { buildPersonaSystemInstruction } from '../../engine/persona.js';

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

/**
 * Model ids that are known to exist, in preference order.
 *
 * The configured ids above are tried first, but a deployment whose key does not
 * expose them must not be left with no model at all: that is what produced
 * "models/gemini-3.8-flash-lite is not found" on every grounded answer. When the
 * catalog probe runs, the real ids the key can use are recorded and used as the
 * fallback chain.
 */
const KNOWN_GEMINI_FALLBACKS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
];

/**
 * Model families that cannot answer a text prompt, or that are far too slow to
 * sit in a chat request path.
 *
 * The catalog probe returns every model the key can call — image generators,
 * TTS voices, music models, robotics and computer-use previews. Feeding that
 * list straight into the retry loop meant a plain chat message tried
 * `gemini-2.5-flash-preview-tts`, `gemma-4-31b-it` and friends first, each
 * costing a failed round-trip. Measured on a real key: 7 dead models before the
 * first success, 28.6s for a one-word reply.
 *
 * `gemini-3.8-flash` is excluded for a different reason: it is a valid text
 * model but measured 92s for "reply with OK" on this account, which no chat
 * request can wait for. It stays reachable through GEMINI_MODEL if an operator
 * explicitly pins it.
 */
const NON_TEXT_MODEL_PATTERN =
  /-tts\b|-tts-|image|imagen|lyria|embedding|aqa|robotics|computer-use|nano-banana|deep-research|antigravity|veo|gemma/i;

/** Models measured as too slow for an interactive request path. */
const SLOW_MODEL_PATTERN = /^gemini-3\.8-flash$/i;

/**
 * Preference order for interactive text generation.
 *
 * Ordered by measured latency on a real key, fastest first, so the common case
 * is one request rather than a walk down a list. A model that is not in the
 * catalog is skipped before any request is made.
 */
const PREFERRED_TEXT_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3-flash-preview',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-3.8-flash',
];

/**
 * Parse `[MM:SS] Speaker N: text` lines into timed segments.
 *
 * Returns an empty array when the model did not follow the format, so the
 * caller falls back to its own segmentation rather than receiving invented
 * timings. A wrong timestamp is worse than an honest coarse one.
 */
export function parseTimedUtterances(
  raw: string,
): Array<{ start: number; end: number; text: string }> {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const parsed: Array<{ start: number; text: string }> = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    // [MM:SS] or [HH:MM:SS], optionally followed by a speaker label.
    const match = line.match(/^\[?(\d{1,2}):(\d{2})(?::(\d{2}))?\]?\s*(?:Speaker\s*\d+\s*:\s*)?(.*)$/i);
    if (!match) continue;
    const hasHours = match[3] !== undefined;
    const start = hasHours
      ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
      : Number(match[1]) * 60 + Number(match[2]);
    const text = (match[4] || '').trim();
    if (!text) continue;
    parsed.push({ start, text });
  }

  if (parsed.length === 0) return [];

  // Each utterance ends where the next begins; the last one gets a short
  // nominal duration because the model does not report an end time.
  return parsed.map((item, index) => {
    const next = parsed[index + 1];
    const end = next ? next.start : item.start + Math.max(2, Math.round(item.text.length / 14));
    return { start: item.start, end: Math.max(end, item.start + 1), text: item.text };
  });
}

export class GeminiCoprocessorProvider implements IModelProvider {
  private apiKey: string | null = null;
  private client: GoogleGenAI | null = null;
  private availabilityCache: { key: string; expiresAt: number; available: boolean } | null = null;
  /** Model ids the key actually exposes, discovered from the catalog. */
  private discoveredModels: string[] = [];

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
        const usable = (data.models || [])
          .filter((model) =>
            model.name && model.supportedGenerationMethods?.includes('generateContent'),
          )
          .map((model) => String(model.name).replace(/^models\//, ''));
        // Remember what this key can really use, so generation never depends on
        // a hardcoded id the account does not have.
        this.discoveredModels = usable;
        available = usable.some((id) => supportedModels.has(`models/${id}`)) || usable.length > 0;
      }
    } catch {
      available = false;
    } finally {
      clearTimeout(timeoutId);
    }
    this.availabilityCache = { key, expiresAt: Date.now() + 15_000, available };
    return available;
  }

  /**
   * True when a model id can plausibly answer a text prompt at interactive
   * speed. Image, TTS, music, robotics and research models are rejected, as is
   * any model measured as too slow for a chat request.
   */
  private isTextModel(modelId: string): boolean {
    if (!modelId) return false;
    if (NON_TEXT_MODEL_PATTERN.test(modelId)) return false;
    if (SLOW_MODEL_PATTERN.test(modelId)) return false;
    return true;
  }

  /**
   * The model ids to try, in order.
   *
   * Configured ids first (an operator may pin a specific model), then the
   * measured-fast preference list, then whatever else the catalog probe found
   * for this key, then the known-good list. Non-text and slow models are
   * filtered out, and a model the catalog did not list is skipped before any
   * request is made — so the common case is a single successful call instead of
   * a walk through every model the account can reach.
   */
  private candidateModelIds(): string[] {
    const catalog = this.discoveredModels;
    const catalogSet = new Set(catalog);

    const ordered = [
      GEMINI_MODEL,
      GEMINI_MODEL_LITE,
      ...PREFERRED_TEXT_MODELS,
      ...catalog,
      ...KNOWN_GEMINI_FALLBACKS,
    ];

    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of ordered) {
      const id = (raw || '').trim();
      if (!id || seen.has(id)) continue;
      if (!this.isTextModel(id)) continue;
      // When the probe ran, trust it: a model absent from the catalog would
      // only cost a 404 round-trip. This applies to the configured ids too —
      // a deployment whose GEMINI_MODEL names a model the key cannot reach
      // (e.g. gemini-3.8-flash-lite, which is not in the catalog at all) was
      // paying a failed request on every single turn before reaching a live
      // model. The configured id is still honoured when the probe could not
      // run, which is the only case where its reachability is unknown.
      if (catalog.length > 0 && !catalogSet.has(id)) continue;
      seen.add(id);
      result.push(id);
    }

    // Never return an empty chain: if every filter removed everything, fall
    // back to the configured ids so the caller still gets a real error from
    // Google rather than a silent "no models".
    if (result.length === 0) {
      return [...new Set([GEMINI_MODEL, GEMINI_MODEL_LITE].filter(Boolean))];
    }
    return result;
  }

  /**
   * True when an error is a transient capacity problem worth retrying.
   *
   * A 429 quota error is NOT retried: the account's quota will not recover
   * within a request, and retrying it three times per model turned a fast
   * failure into a multi-minute hang. Only genuine capacity spikes (500/503)
   * are retried.
   */
  private isTransient(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    if (/"code":\s*429|RESOURCE_EXHAUSTED|quota/i.test(message)) return false;
    return /"code":\s*(500|503)|UNAVAILABLE|high demand|overloaded/i.test(message);
  }

  /**
   * Whether a model id can plausibly accept audio input.
   *
   * The catalog lists every model the key can use, including text-to-speech
   * models and gemma variants that reject audio with "Audio input modality is
   * not enabled". Trying those first wasted a round-trip each and, with retries,
   * dominated the request time. TTS and non-multimodal families are skipped.
   */
  private canAcceptAudio(modelId: string): boolean {
    const id = modelId.toLowerCase();
    if (id.includes('-tts') || id.includes('embedding') || id.includes('aqa')) return false;
    if (id.startsWith('gemma')) return false;
    return true;
  }

  public async generate(
    prompt: string,
    context?: string,
    options?: GenerationOptions & { thinkHarder?: boolean; persona?: string }
  ): Promise<GenerationResult> {
    const ai = this.getClient();

    const personaTone = buildPersonaSystemInstruction(options?.persona);

    const systemInstruction = `${
      options?.systemPrompt ||
      'You are RARE, a standalone personal AI companion, researcher, and full-stack software builder.'
    }\n${personaTone}\n\nContext & Memory:\n${context || 'None'}`;

    const candidateModels = this.candidateModelIds();
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
    const personaTone = buildPersonaSystemInstruction(options?.persona);

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
    // The streaming path must honour the same reasoning-effort switch as the
    // non-streaming one. It previously dropped `thinkHarder` entirely, so a
    // streamed turn silently ignored the Think Harder control.
    const isDeepReasoning = options?.thinkHarder === true;
    const streamConfig: any = {
      systemInstruction,
      temperature: options?.temperature ?? 0.7,
    };
    if (isDeepReasoning) {
      streamConfig.thinkingConfig = { thinkingBudget: 4096 };
    }

    for (const modelId of this.candidateModelIds()) {
      // Once any token has been yielded, a retry would duplicate text the caller
      // has already rendered, so the fallback is only safe before the first token.
      let emitted = false;
      try {
        const stream = await ai.models.generateContentStream({
          model: modelId,
          contents: contentsPayload,
          config: streamConfig,
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

  public async transcribeAudio(
    audioBase64: string,
    mimeType: string,
  ): Promise<{ text: string; model: string; segments?: Array<{ start: number; end: number; text: string }> }> {
    if (!audioBase64 || audioBase64.length > 14_000_000) {
      throw new Error('Audio data is missing or exceeds the 10 MB limit.');
    }
    const ai = this.getClient();
    // Refresh the model catalog first so the live ids lead the candidate list.
    // Without this the hardcoded ids are tried first and every retired one
    // costs a 404 round-trip before a working model is reached.
    if (this.discoveredModels.length === 0) {
      try {
        await this.isAvailable();
      } catch {
        /* probe is best-effort; the candidate list still has fallbacks */
      }
    }
    // Model names are configurable: Google retires models on a schedule, and a
    // hardcoded id silently breaks transcription the day it is withdrawn
    // (gemini-2.5-flash now returns 404 "no longer available to new users").
    let lastError: unknown = null;
    const audioModels = this.candidateModelIds().filter((id) => this.canAcceptAudio(id));
    for (const modelId of audioModels) {
      // A transient 503 ("high demand") is not a reason to give up on the only
      // live model, so retry it a couple of times with a short backoff.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          // Both parts must be Part objects. Mixing a Part with a bare string in
          // `contents` is rejected by the API, which made every audio request
          // fail while text generation (which uses a plain string) kept working.
          const response = await ai.models.generateContent({
            model: modelId,
            contents: [
              {
                // Ask for timed utterances, not a flat paragraph. A flat
                // transcript forces the caller to collapse the whole segment
                // into one turn, which makes every timestamp inside it wrong.
                // The format is stated explicitly so it can be parsed.
                text:
                  'Transcribe the supplied audio verbatim. Preserve speaker changes when clear. ' +
                  'Mark uncertain or inaudible speech as [inaudible]; do not infer words from context. ' +
                  'Return one line per utterance in exactly this format:\n' +
                  '[MM:SS] Speaker N: text\n' +
                  'Use the real start time of each utterance in the audio. Do not merge separate utterances into one line.',
              },
              { inlineData: { mimeType, data: audioBase64 } },
            ],
          });
          const text = response.text;
          if (typeof text !== 'string' || text.trim().length === 0) {
            throw new Error('Gemini returned an empty audio transcription.');
          }
          return { text, model: modelId, segments: parseTimedUtterances(text) };
        } catch (error) {
          lastError = error;
          // Log the real reason. Swallowing it turned a diagnosable API error
          // into an opaque "every segment failed" for the user.
          const detail = error instanceof Error ? error.message : String(error);
          console.warn(
            `[GeminiCoprocessorProvider] Transcription model ${modelId} failed (attempt ${attempt + 1}): ${detail.slice(0, 300)}`,
          );
          if (!this.isTransient(error) || attempt === 2) break;
          await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('All configured Gemini transcription models failed.');
  }
}
