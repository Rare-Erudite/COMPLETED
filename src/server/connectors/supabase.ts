/**
 * RARE — Supabase connector (real)
 *
 * Talks to the project's PostgREST endpoint with the service/secret key.
 * Verified against https://<project>.supabase.co/rest/v1/.
 *
 * Actions:
 *   - list_tables   GET  /rest/v1/  (OpenAPI root lists tables)
 *   - select_rows   GET  /rest/v1/{table}
 *   - insert_row    POST /rest/v1/{table}
 *   - update_rows   PATCH /rest/v1/{table}?{filter}
 *   - delete_rows   DELETE /rest/v1/{table}?{filter}
 *   - storage_list  GET  /storage/v1/object/list/{bucket}
 */

import type {
  ConnectorDefinition,
  ConnectorContext,
  ConnectorTestResult,
  ConnectorActionResult,
} from './types.js';
import { describeFailure } from './http.js';

function baseUrl(ctx: ConnectorContext): string {
  const raw = String(ctx.credentials.projectUrl || '').trim().replace(/\/+$/, '');
  if (!raw) throw new Error('projectUrl is required');
  // Accept either the bare project URL or one ending in /rest/v1.
  return raw.replace(/\/rest\/v1$/, '');
}

function headers(ctx: ConnectorContext): Record<string, string> {
  const key = String(ctx.credentials.secretKey || ctx.credentials.publishableKey || '');
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

export const supabaseConnector: ConnectorDefinition = {
  id: 'supabase',
  name: 'Supabase',
  category: 'data',
  description: 'Postgres tables, rows and storage in a Supabase project.',
  docsUrl: 'https://supabase.com/dashboard/project/_/settings/api',
  authKind: 'api-key',
  credentialFields: [
    {
      key: 'projectUrl',
      label: 'Project URL',
      secret: false,
      required: true,
      placeholder: 'https://xxxx.supabase.co',
    },
    {
      key: 'secretKey',
      label: 'Secret / service key',
      secret: true,
      required: true,
      placeholder: 'sb_secret_… or service_role JWT',
      help: 'Server-side key. Never expose it to a browser.',
    },
  ],
  capabilities: [
    { id: 'list_tables', name: 'List tables', description: 'Tables exposed by the REST API.' },
    {
      id: 'select_rows',
      name: 'Select rows',
      description: 'Read rows from a table.',
      params: [
        { key: 'table', label: 'Table', type: 'string', required: true },
        { key: 'limit', label: 'Limit', type: 'number', required: false },
        { key: 'select', label: 'Columns (e.g. *)', type: 'string', required: false },
      ],
    },
    {
      id: 'insert_row',
      name: 'Insert row',
      description: 'Insert one row into a table.',
      mutating: true,
      params: [
        { key: 'table', label: 'Table', type: 'string', required: true },
        { key: 'row', label: 'Row JSON', type: 'json', required: true },
      ],
    },
    {
      id: 'update_rows',
      name: 'Update rows',
      description: 'Update rows matching a filter.',
      mutating: true,
      params: [
        { key: 'table', label: 'Table', type: 'string', required: true },
        { key: 'filter', label: 'Filter (e.g. id=eq.1)', type: 'string', required: true },
        { key: 'patch', label: 'Patch JSON', type: 'json', required: true },
      ],
    },
    {
      id: 'delete_rows',
      name: 'Delete rows',
      description: 'Delete rows matching a filter.',
      mutating: true,
      params: [
        { key: 'table', label: 'Table', type: 'string', required: true },
        { key: 'filter', label: 'Filter (e.g. id=eq.1)', type: 'string', required: true },
      ],
    },
    {
      id: 'storage_list',
      name: 'List storage objects',
      description: 'List objects in a storage bucket.',
      params: [
        { key: 'bucket', label: 'Bucket', type: 'string', required: true },
        { key: 'prefix', label: 'Prefix', type: 'string', required: false },
      ],
    },
  ],

  async test(ctx: ConnectorContext): Promise<ConnectorTestResult> {
    const started = Date.now();
    const res = await ctx.fetchJson<any>(`${baseUrl(ctx)}/rest/v1/`, { headers: headers(ctx) });
    const latencyMs = Date.now() - started;
    if (!res.ok || !res.data) {
      return { ok: false, detail: describeFailure(res.status, res.text), httpStatus: res.status, latencyMs };
    }
    const tables = Object.keys(res.data.definitions || {});
    return {
      ok: true,
      detail: `Connected to Supabase REST (${tables.length} table(s) exposed)`,
      evidence: { tables: tables.slice(0, 50), tableCount: tables.length },
      httpStatus: res.status,
      latencyMs,
    };
  },

  async action(actionId, args, ctx): Promise<ConnectorActionResult> {
    const started = Date.now();
    const done = (r: ConnectorActionResult): ConnectorActionResult => ({ ...r, latencyMs: Date.now() - started });
    try {
      const base = baseUrl(ctx);
      switch (actionId) {
        case 'list_tables': {
          const res = await ctx.fetchJson<any>(`${base}/rest/v1/`, { headers: headers(ctx) });
          if (!res.ok) return done({ ok: false, action: actionId, error: describeFailure(res.status, res.text), httpStatus: res.status });
          return done({ ok: true, action: actionId, httpStatus: res.status, data: Object.keys(res.data?.definitions || {}) });
        }
        case 'select_rows': {
          const table = String(args.table || '');
          const limit = Math.min(Number(args.limit) || 20, 200);
          const select = String(args.select || '*');
          const res = await ctx.fetchJson<any[]>(
            `${base}/rest/v1/${encodeURIComponent(table)}?select=${encodeURIComponent(select)}&limit=${limit}`,
            { headers: headers(ctx) },
          );
          if (!res.ok) return done({ ok: false, action: actionId, error: describeFailure(res.status, res.text), httpStatus: res.status });
          return done({ ok: true, action: actionId, httpStatus: res.status, data: res.data });
        }
        case 'insert_row': {
          const table = String(args.table || '');
          const row = typeof args.row === 'string' ? JSON.parse(args.row) : args.row;
          const res = await ctx.fetchJson<any>(`${base}/rest/v1/${encodeURIComponent(table)}`, {
            method: 'POST',
            headers: { ...headers(ctx), Prefer: 'return=representation' },
            body: JSON.stringify(row),
          });
          if (!res.ok) return done({ ok: false, action: actionId, error: describeFailure(res.status, res.text), httpStatus: res.status });
          return done({ ok: true, action: actionId, httpStatus: res.status, data: res.data });
        }
        case 'update_rows': {
          const table = String(args.table || '');
          const filter = String(args.filter || '');
          const patch = typeof args.patch === 'string' ? JSON.parse(args.patch) : args.patch;
          const res = await ctx.fetchJson<any>(`${base}/rest/v1/${encodeURIComponent(table)}?${filter}`, {
            method: 'PATCH',
            headers: { ...headers(ctx), Prefer: 'return=representation' },
            body: JSON.stringify(patch),
          });
          if (!res.ok) return done({ ok: false, action: actionId, error: describeFailure(res.status, res.text), httpStatus: res.status });
          return done({ ok: true, action: actionId, httpStatus: res.status, data: res.data });
        }
        case 'delete_rows': {
          const table = String(args.table || '');
          const filter = String(args.filter || '');
          const res = await ctx.fetchJson<any>(`${base}/rest/v1/${encodeURIComponent(table)}?${filter}`, {
            method: 'DELETE',
            headers: { ...headers(ctx), Prefer: 'return=representation' },
          });
          if (!res.ok) return done({ ok: false, action: actionId, error: describeFailure(res.status, res.text), httpStatus: res.status });
          return done({ ok: true, action: actionId, httpStatus: res.status, data: res.data });
        }
        case 'storage_list': {
          const bucket = String(args.bucket || '');
          const prefix = String(args.prefix || '');
          const res = await ctx.fetchJson<any>(`${base}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
            method: 'POST',
            headers: headers(ctx),
            body: JSON.stringify({ prefix, limit: 100 }),
          });
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
