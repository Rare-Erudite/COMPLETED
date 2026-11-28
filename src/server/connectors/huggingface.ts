/**
 * RARE — Hugging Face connector (real)
 *
 * Verified against huggingface.co/api. Actions:
 *   - list_models     GET  /api/models
 *   - get_model       GET  /api/models/{id}
 *   - search_models   GET  /api/models?search=
 *   - list_datasets   GET  /api/datasets
 *   - whoami          GET  /api/whoami-v2   (needs a token)
 *
 * The public model/dataset endpoints work without a token; a token unlocks
 * whoami and private repos. The connector therefore accepts an optional token.
 */

import type {
  ConnectorDefinition,
  ConnectorContext,
  ConnectorTestResult,
  ConnectorActionResult,
} from './types.js';
import { describeFailure } from './http.js';

const API = 'https://huggingface.co';

function headers(ctx: ConnectorContext): Record<string, string> {
  const h: Record<string, string> = { 'User-Agent': 'RARE-Connector' };
  if (ctx.credentials.token) h.Authorization = `Bearer ${ctx.credentials.token}`;
  return h;
}

export const huggingfaceConnector: ConnectorDefinition = {
  id: 'huggingface',
  name: 'Hugging Face',
  category: 'ai',
  description: 'Models and datasets on the Hugging Face Hub.',
  docsUrl: 'https://huggingface.co/settings/tokens',
  authKind: 'token',
  credentialFields: [
    {
      key: 'token',
      label: 'Access token (optional)',
      secret: true,
      required: false,
      placeholder: 'hf_…',
      help: 'Optional. Public model/dataset browsing works without it; a token unlocks whoami and private repos.',
    },
  ],
  capabilities: [
    {
      id: 'list_models',
      name: 'List models',
      description: 'Top models by downloads.',
      params: [{ key: 'limit', label: 'Limit', type: 'number', required: false }],
    },
    {
      id: 'search_models',
      name: 'Search models',
      description: 'Search the model hub.',
      params: [
        { key: 'query', label: 'Query', type: 'string', required: true },
        { key: 'limit', label: 'Limit', type: 'number', required: false },
      ],
    },
    {
      id: 'get_model',
      name: 'Inspect model',
      description: 'Metadata for one model.',
      params: [{ key: 'id', label: 'Model id', type: 'string', required: true }],
    },
    {
      id: 'list_datasets',
      name: 'List datasets',
      description: 'Top datasets by downloads.',
      params: [{ key: 'limit', label: 'Limit', type: 'number', required: false }],
    },
    { id: 'whoami', name: 'Who am I', description: 'The account the token belongs to (needs a token).' },
  ],

  async test(ctx: ConnectorContext): Promise<ConnectorTestResult> {
    const started = Date.now();
    // A public call always proves reachability; a token additionally proves identity.
    const res = await ctx.fetchJson<any[]>(`${API}/api/models?limit=1`, { headers: headers(ctx) });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return { ok: false, detail: describeFailure(res.status, res.text), httpStatus: res.status, latencyMs };
    }
    if (ctx.credentials.token) {
      const who = await ctx.fetchJson<any>(`${API}/api/whoami-v2`, { headers: headers(ctx) });
      if (who.ok && who.data) {
        return {
          ok: true,
          detail: `Connected to Hugging Face as ${who.data.name || who.data.fullname || 'token owner'}`,
          evidence: { user: who.data.name, type: who.data.type },
          httpStatus: res.status,
          latencyMs,
        };
      }
    }
    return {
      ok: true,
      detail: 'Connected to the Hugging Face Hub (public access)',
      evidence: { public: true },
      httpStatus: res.status,
      latencyMs,
    };
  },

  async action(actionId, args, ctx): Promise<ConnectorActionResult> {
    const started = Date.now();
    const done = (r: ConnectorActionResult): ConnectorActionResult => ({ ...r, latencyMs: Date.now() - started });
    try {
      switch (actionId) {
        case 'list_models': {
          const limit = Math.min(Number(args.limit) || 10, 50);
          const res = await ctx.fetchJson<any[]>(
            `${API}/api/models?limit=${limit}&sort=downloads&direction=-1`,
            { headers: headers(ctx) },
          );
          if (!res.ok) return done({ ok: false, action: actionId, error: describeFailure(res.status, res.text), httpStatus: res.status });
          return done({
            ok: true,
            action: actionId,
            httpStatus: res.status,
            data: (res.data || []).map((m) => ({ id: m.id, downloads: m.downloads, likes: m.likes, pipeline_tag: m.pipeline_tag })),
          });
        }
        case 'search_models': {
          const limit = Math.min(Number(args.limit) || 10, 50);
          const q = encodeURIComponent(String(args.query || ''));
          const res = await ctx.fetchJson<any[]>(`${API}/api/models?search=${q}&limit=${limit}`, { headers: headers(ctx) });
          if (!res.ok) return done({ ok: false, action: actionId, error: describeFailure(res.status, res.text), httpStatus: res.status });
          return done({
            ok: true,
            action: actionId,
            httpStatus: res.status,
            data: (res.data || []).map((m) => ({ id: m.id, downloads: m.downloads, likes: m.likes })),
          });
        }
        case 'get_model': {
          const id = String(args.id || '');
          const res = await ctx.fetchJson<any>(`${API}/api/models/${id}`, { headers: headers(ctx) });
          if (!res.ok) return done({ ok: false, action: actionId, error: describeFailure(res.status, res.text), httpStatus: res.status });
          return done({
            ok: true,
            action: actionId,
            httpStatus: res.status,
            data: {
              id: res.data?.id,
              pipeline_tag: res.data?.pipeline_tag,
              downloads: res.data?.downloads,
              likes: res.data?.likes,
              tags: res.data?.tags,
              siblings: (res.data?.siblings || []).slice(0, 20).map((s: any) => s.rfilename),
            },
          });
        }
        case 'list_datasets': {
          const limit = Math.min(Number(args.limit) || 10, 50);
          const res = await ctx.fetchJson<any[]>(
            `${API}/api/datasets?limit=${limit}&sort=downloads&direction=-1`,
            { headers: headers(ctx) },
          );
          if (!res.ok) return done({ ok: false, action: actionId, error: describeFailure(res.status, res.text), httpStatus: res.status });
          return done({
            ok: true,
            action: actionId,
            httpStatus: res.status,
            data: (res.data || []).map((d) => ({ id: d.id, downloads: d.downloads, likes: d.likes })),
          });
        }
        case 'whoami': {
          const res = await ctx.fetchJson<any>(`${API}/api/whoami-v2`, { headers: headers(ctx) });
          if (!res.ok) return done({ ok: false, action: actionId, error: describeFailure(res.status, res.text), httpStatus: res.status });
          return done({ ok: true, action: actionId, httpStatus: res.status, data: res.data });
        }
        default:
          return done({ ok: false, action: actionId, error: `Unknown action: ${actionId}` });
      }
    } catch (error) {
      return done({ ok: false, action: actionId, error: error instanceof Error ? error.message : String(error) });
    }
  },
};
