/**
 * RARE — Vercel connector (real)
 *
 * Verified against api.vercel.com. Actions:
 *   - list_projects     GET  /v9/projects
 *   - list_deployments  GET  /v6/deployments
 *   - trigger_deploy    POST /v13/deployments
 *   - read_logs         GET  /v2/deployments/{id}/events
 *   - get_deployment    GET  /v13/deployments/{id}
 */

import type {
  ConnectorDefinition,
  ConnectorContext,
  ConnectorTestResult,
  ConnectorActionResult,
} from './types.js';
import { describeFailure } from './http.js';

const API = 'https://api.vercel.com';

function headers(ctx: ConnectorContext): Record<string, string> {
  return {
    Authorization: `Bearer ${ctx.credentials.token}`,
    'Content-Type': 'application/json',
  };
}

export const vercelConnector: ConnectorDefinition = {
  id: 'vercel',
  name: 'Vercel',
  category: 'cloud',
  description: 'Projects, deployments, deploy triggers and build logs on Vercel.',
  docsUrl: 'https://vercel.com/account/tokens',
  authKind: 'token',
  credentialFields: [
    { key: 'token', label: 'Vercel access token', secret: true, required: true, placeholder: 'vcp_…' },
  ],
  capabilities: [
    { id: 'list_projects', name: 'List projects', description: 'List projects in the account/team.' },
    {
      id: 'list_deployments',
      name: 'List deployments',
      description: 'Recent deployments, optionally for one project.',
      params: [{ key: 'projectId', label: 'Project id', type: 'string', required: false }],
    },
    {
      id: 'trigger_deploy',
      name: 'Trigger deployment',
      description: 'Create a new deployment from a git ref.',
      mutating: true,
      params: [
        { key: 'name', label: 'Project name', type: 'string', required: true },
        { key: 'gitSource', label: 'Git source JSON', type: 'json', required: true },
        { key: 'target', label: 'Target (production/preview)', type: 'string', required: false },
      ],
    },
    {
      id: 'read_logs',
      name: 'Read deployment logs',
      description: 'Build events for a deployment.',
      params: [{ key: 'deploymentId', label: 'Deployment id', type: 'string', required: true }],
    },
    {
      id: 'get_deployment',
      name: 'Get deployment',
      description: 'State and metadata for one deployment.',
      params: [{ key: 'deploymentId', label: 'Deployment id', type: 'string', required: true }],
    },
  ],

  async test(ctx: ConnectorContext): Promise<ConnectorTestResult> {
    const started = Date.now();
    const res = await ctx.fetchJson<{ user?: { username?: string; email?: string; id?: string } }>(
      `${API}/v2/user`,
      { headers: headers(ctx) },
    );
    const latencyMs = Date.now() - started;
    if (!res.ok || !res.data) {
      return { ok: false, detail: describeFailure(res.status, res.text), httpStatus: res.status, latencyMs };
    }
    const u = res.data.user || {};
    return {
      ok: true,
      detail: `Authenticated as ${u.username || u.email || u.id || 'Vercel user'}`,
      evidence: { username: u.username, id: u.id },
      httpStatus: res.status,
      latencyMs,
    };
  },

  async action(actionId, args, ctx): Promise<ConnectorActionResult> {
    const started = Date.now();
    const done = (r: ConnectorActionResult): ConnectorActionResult => ({ ...r, latencyMs: Date.now() - started });
    try {
      switch (actionId) {
        case 'list_projects': {
          const res = await ctx.fetchJson<any>(`${API}/v9/projects?limit=50`, { headers: headers(ctx) });
          if (!res.ok) return done({ ok: false, action: actionId, error: describeFailure(res.status, res.text), httpStatus: res.status });
          return done({
            ok: true,
            action: actionId,
            httpStatus: res.status,
            data: (res.data?.projects || []).map((p: any) => ({ id: p.id, name: p.name, framework: p.framework })),
          });
        }
        case 'list_deployments': {
          const projectId = args.projectId ? `&projectId=${encodeURIComponent(String(args.projectId))}` : '';
          const res = await ctx.fetchJson<any>(`${API}/v6/deployments?limit=20${projectId}`, { headers: headers(ctx) });
          if (!res.ok) return done({ ok: false, action: actionId, error: describeFailure(res.status, res.text), httpStatus: res.status });
          return done({
            ok: true,
            action: actionId,
            httpStatus: res.status,
            data: (res.data?.deployments || []).map((d: any) => ({
              uid: d.uid,
              name: d.name,
              state: d.state,
              url: d.url,
              createdAt: d.createdAt,
            })),
          });
        }
        case 'trigger_deploy': {
          const body: Record<string, unknown> = {
            name: String(args.name || ''),
            gitSource: typeof args.gitSource === 'string' ? JSON.parse(args.gitSource) : args.gitSource,
          };
          if (args.target) body.target = String(args.target);
          const res = await ctx.fetchJson<any>(`${API}/v13/deployments`, {
            method: 'POST',
            headers: headers(ctx),
            body: JSON.stringify(body),
          });
          if (!res.ok) return done({ ok: false, action: actionId, error: describeFailure(res.status, res.text), httpStatus: res.status });
          return done({
            ok: true,
            action: actionId,
            httpStatus: res.status,
            data: { id: res.data?.id, url: res.data?.url, state: res.data?.readyState },
          });
        }
        case 'read_logs': {
          const id = String(args.deploymentId || '');
          const res = await ctx.fetchJson<any[]>(`${API}/v2/deployments/${id}/events?limit=100`, { headers: headers(ctx) });
          if (!res.ok) return done({ ok: false, action: actionId, error: describeFailure(res.status, res.text), httpStatus: res.status });
          return done({
            ok: true,
            action: actionId,
            httpStatus: res.status,
            data: (res.data || []).map((e: any) => ({ type: e.type, created: e.created, text: e.text || e.payload?.text })),
          });
        }
        case 'get_deployment': {
          const id = String(args.deploymentId || '');
          const res = await ctx.fetchJson<any>(`${API}/v13/deployments/${id}`, { headers: headers(ctx) });
          if (!res.ok) return done({ ok: false, action: actionId, error: describeFailure(res.status, res.text), httpStatus: res.status });
          return done({
            ok: true,
            action: actionId,
            httpStatus: res.status,
            data: { id: res.data?.id, url: res.data?.url, readyState: res.data?.readyState, createdAt: res.data?.createdAt },
          });
        }
        default:
          return done({ ok: false, action: actionId, error: `Unknown action: ${actionId}` });
      }
    } catch (error) {
      return done({ ok: false, action: actionId, error: error instanceof Error ? error.message : String(error) });
    }
  },
};
