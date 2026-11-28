/**
 * RARE — Gemini connector (real)
 *
 * Verified against generativelanguage.googleapis.com. The model list is
 * discovered live, so a retired model name never silently breaks the
 * connector: `chat` picks the first working text model from a preference
 * list and falls back through the live catalogue.
 *
 * Actions:
 *   - list_models   GET  /v1beta/models
 *   - chat          POST /v1beta/models/{model}:generateContent
 */

import type {
  ConnectorDefinition,
  ConnectorContext,
  ConnectorTestResult,
  ConnectorActionResult,
} from './types.js';
import { describeFailure } from './http.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';

// Preference order for text generation. The connector verifies against the
// live catalogue, so a name that has been retired is skipped, not fatal.
const TEXT_MODEL_PREFERENCE = [
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-flash-latest',
];

function headers(ctx: ConnectorContext): Record<string, string> {
  return {
    'x-goog-api-key': String(ctx.credentials.apiKey || ''),
    'Content-Type': 'application/json',
  };
}

async function listTextModels(ctx: ConnectorContext): Promise<string[]> {
  const res = await ctx.fetchJson<any>(`${API}/models`, { headers: headers(ctx) });
  if (!res.ok || !res.data?.models) return [];
  return (res.data.models as any[])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name).replace(/^models\//, ''));
}

function pickModel(available: string[]): string | null {
  for (const pref of TEXT_MODEL_PREFERENCE) {
    if (available.includes(pref)) return pref;
  }
  // Any non-image, non-tts text model.
  return (
    available.find(
      (m) => !/image|tts|transcribe|embedding|aqa/i.test(m) && /flash|pro/i.test(m),
    ) || null
  );
}

export const geminiConnector: ConnectorDefinition = {
  id: 'gemini',
  name: 'Google Gemini',
  category: 'ai',
  description: 'Gemini text generation and model catalogue.',
  docsUrl: 'https://aistudio.google.com/app/apikey',
  authKind: 'api-key',
  credentialFields: [
    { key: 'apiKey', label: 'Gemini API key', secret: true, required: true, placeholder: 'AIza… or AQ.…' },
  ],
  capabilities: [
    { id: 'list_models', name: 'List models', description: 'Text-capable models available to this key.' },
    {
      id: 'chat',
      name: 'Chat completion',
      description: 'Send a prompt and get a completion.',
      params: [
        { key: 'prompt', label: 'Prompt', type: 'string', required: true },
        { key: 'model', label: 'Model (optional)', type: 'string', required: false },
      ],
    },
  ],

  async test(ctx: ConnectorContext): Promise<ConnectorTestResult> {
    const started = Date.now();
    const res = await ctx.fetchJson<any>(`${API}/models`, { headers: headers(ctx) });
    const latencyMs = Date.now() - started;
    if (!res.ok || !res.data) {
      return { ok: false, detail: describeFailure(res.status, res.text), httpStatus: res.status, latencyMs };
    }
    const available = await listTextModels(ctx);
    const model = pickModel(available);
    if (!model) {
      return { ok: false, detail: 'Key is valid but no text model is available to it.', httpStatus: res.status, latencyMs };
    }
    // Prove generation actually works, not just that the key lists models.
    const gen = await ctx.fetchJson<any>(`${API}/models/${model}:generateContent`, {
      method: 'POST',
      headers: headers(ctx),
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with exactly: OK' }] }] }),
      timeoutMs: 45000,
    });
    const totalMs = Date.now() - started;
    if (!gen.ok) {
      return { ok: false, detail: `Model ${model} failed: ${describeFailure(gen.status, gen.text)}`, httpStatus: gen.status, latencyMs: totalMs };
    }
    const text = gen.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return {
      ok: true,
      detail: `Gemini reachable; ${model} replied "${text.trim().slice(0, 40)}"`,
      evidence: { model, textModels: available.length },
      httpStatus: gen.status,
      latencyMs: totalMs,
    };
  },

  async action(actionId, args, ctx): Promise<ConnectorActionResult> {
    const started = Date.now();
    const done = (r: ConnectorActionResult): ConnectorActionResult => ({ ...r, latencyMs: Date.now() - started });
    try {
      switch (actionId) {
        case 'list_models': {
          const available = await listTextModels(ctx);
          return done({ ok: true, action: actionId, data: available });
        }
        case 'chat': {
          const available = await listTextModels(ctx);
          const model = String(args.model || '') || pickModel(available);
          if (!model) return done({ ok: false, action: actionId, error: 'No text model available to this key.' });
          const res = await ctx.fetchJson<any>(`${API}/models/${model}:generateContent`, {
            method: 'POST',
            headers: headers(ctx),
            body: JSON.stringify({ contents: [{ parts: [{ text: String(args.prompt || '') }] }] }),
            timeoutMs: 60000,
          });
          if (!res.ok) return done({ ok: false, action: actionId, error: describeFailure(res.status, res.text), httpStatus: res.status });
          const text = res.data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('') || '';
          return done({ ok: true, action: actionId, httpStatus: res.status, data: { model, text } });
        }
        default:
          return done({ ok: false, action: actionId, error: `Unknown action: ${actionId}` });
      }
    } catch (error) {
      return done({ ok: false, action: actionId, error: error instanceof Error ? error.message : String(error) });
    }
  },
};
