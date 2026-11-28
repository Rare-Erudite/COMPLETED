/**
 * RARE — GitHub connector (real)
 *
 * Verified against api.github.com with a fine-grained PAT. Actions:
 *   - list_repos        GET  /user/repos
 *   - get_repo          GET  /repos/{owner}/{repo}
 *   - list_commits      GET  /repos/{owner}/{repo}/commits
 *   - read_file         GET  /repos/{owner}/{repo}/contents/{path}
 *   - write_file        PUT  /repos/{owner}/{repo}/contents/{path}
 *   - create_issue      POST /repos/{owner}/{repo}/issues
 *   - list_issues       GET  /repos/{owner}/{repo}/issues
 */

import type {
  ConnectorDefinition,
  ConnectorContext,
  ConnectorTestResult,
  ConnectorActionResult,
} from './types.js';
import { describeFailure } from './http.js';

const API = 'https://api.github.com';

function headers(ctx: ConnectorContext): Record<string, string> {
  return {
    Authorization: `Bearer ${ctx.credentials.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'RARE-Connector',
  };
}

function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = String(repo || '').split('/');
  if (!owner || !name) throw new Error('repo must be "owner/name"');
  return { owner, name };
}

export const githubConnector: ConnectorDefinition = {
  id: 'github',
  name: 'GitHub',
  category: 'dev',
  description: 'Repositories, files, commits and issues on github.com.',
  docsUrl: 'https://github.com/settings/tokens',
  authKind: 'token',
  credentialFields: [
    {
      key: 'token',
      label: 'Personal access token',
      secret: true,
      required: true,
      placeholder: 'github_pat_… or ghp_…',
      help: 'Fine-grained token with repo contents + issues read/write.',
    },
  ],
  capabilities: [
    { id: 'list_repos', name: 'List repositories', description: 'List repositories the token can access.' },
    {
      id: 'get_repo',
      name: 'Get repository',
      description: 'Metadata for one repository.',
      params: [{ key: 'repo', label: 'owner/name', type: 'string', required: true }],
    },
    {
      id: 'list_commits',
      name: 'List commits',
      description: 'Recent commits on a repository.',
      params: [
        { key: 'repo', label: 'owner/name', type: 'string', required: true },
        { key: 'limit', label: 'Limit', type: 'number', required: false },
      ],
    },
    {
      id: 'read_file',
      name: 'Read file',
      description: 'Read a file from a repository.',
      params: [
        { key: 'repo', label: 'owner/name', type: 'string', required: true },
        { key: 'path', label: 'Path', type: 'string', required: true },
        { key: 'ref', label: 'Branch/ref', type: 'string', required: false },
      ],
    },
    {
      id: 'write_file',
      name: 'Write file',
      description: 'Create or update a file (commits to the branch).',
      mutating: true,
      params: [
        { key: 'repo', label: 'owner/name', type: 'string', required: true },
        { key: 'path', label: 'Path', type: 'string', required: true },
        { key: 'content', label: 'Content', type: 'string', required: true },
        { key: 'message', label: 'Commit message', type: 'string', required: true },
        { key: 'branch', label: 'Branch', type: 'string', required: false },
      ],
    },
    {
      id: 'create_issue',
      name: 'Create issue',
      description: 'Open an issue on a repository.',
      mutating: true,
      params: [
        { key: 'repo', label: 'owner/name', type: 'string', required: true },
        { key: 'title', label: 'Title', type: 'string', required: true },
        { key: 'body', label: 'Body', type: 'string', required: false },
      ],
    },
    {
      id: 'list_issues',
      name: 'List issues',
      description: 'List issues on a repository.',
      params: [{ key: 'repo', label: 'owner/name', type: 'string', required: true }],
    },
  ],

  async test(ctx: ConnectorContext): Promise<ConnectorTestResult> {
    const started = Date.now();
    const res = await ctx.fetchJson<{ login: string; id: number; name?: string }>(
      `${API}/user`,
      { headers: headers(ctx) },
    );
    const latencyMs = Date.now() - started;
    if (!res.ok || !res.data) {
      return { ok: false, detail: describeFailure(res.status, res.text), httpStatus: res.status, latencyMs };
    }
    return {
      ok: true,
      detail: `Authenticated as ${res.data.login} (id ${res.data.id})`,
      evidence: { login: res.data.login, id: res.data.id },
      httpStatus: res.status,
      latencyMs,
    };
  },

  async action(actionId, args, ctx): Promise<ConnectorActionResult> {
    const started = Date.now();
    const done = (r: ConnectorActionResult): ConnectorActionResult => ({
      ...r,
      latencyMs: Date.now() - started,
    });
    try {
      switch (actionId) {
        case 'list_repos': {
          const res = await ctx.fetchJson<any[]>(`${API}/user/repos?per_page=30&sort=updated`, {
            headers: headers(ctx),
          });
          if (!res.ok) return done({ ok: false, action: actionId, error: describeFailure(res.status, res.text), httpStatus: res.status });
          return done({
            ok: true,
            action: actionId,
            httpStatus: res.status,
            data: (res.data || []).map((r) => ({
              full_name: r.full_name,
              private: r.private,
              default_branch: r.default_branch,
              updated_at: r.updated_at,
            })),
          });
        }
        case 'get_repo': {
          const { owner, name } = splitRepo(String(args.repo));
          const res = await ctx.fetchJson<any>(`${API}/repos/${owner}/${name}`, { headers: headers(ctx) });
          if (!res.ok) return done({ ok: false, action: actionId, error: describeFailure(res.status, res.text), httpStatus: res.status });
          return done({ ok: true, action: actionId, httpStatus: res.status, data: res.data });
        }
        case 'list_commits': {
          const { owner, name } = splitRepo(String(args.repo));
          const limit = Math.min(Number(args.limit) || 10, 50);
          const res = await ctx.fetchJson<any[]>(`${API}/repos/${owner}/${name}/commits?per_page=${limit}`, {
            headers: headers(ctx),
          });
          if (!res.ok) return done({ ok: false, action: actionId, error: describeFailure(res.status, res.text), httpStatus: res.status });
          return done({
            ok: true,
            action: actionId,
            httpStatus: res.status,
            data: (res.data || []).map((c) => ({
              sha: c.sha,
              message: c.commit?.message?.split('\n')[0],
              author: c.commit?.author?.name,
              date: c.commit?.author?.date,
            })),
          });
        }
        case 'read_file': {
          const { owner, name } = splitRepo(String(args.repo));
          const path = String(args.path || '');
          const ref = args.ref ? `?ref=${encodeURIComponent(String(args.ref))}` : '';
          const res = await ctx.fetchJson<any>(`${API}/repos/${owner}/${name}/contents/${path}${ref}`, {
            headers: headers(ctx),
          });
          if (!res.ok) return done({ ok: false, action: actionId, error: describeFailure(res.status, res.text), httpStatus: res.status });
          const content = res.data?.content
            ? Buffer.from(res.data.content, 'base64').toString('utf8')
            : null;
          return done({
            ok: true,
            action: actionId,
            httpStatus: res.status,
            data: { path, sha: res.data?.sha, size: res.data?.size, content },
          });
        }
        case 'write_file': {
          const { owner, name } = splitRepo(String(args.repo));
          const path = String(args.path || '');
          const branch = args.branch ? String(args.branch) : undefined;
          // Need the current sha to update an existing file.
          let sha: string | undefined;
          const existing = await ctx.fetchJson<any>(
            `${API}/repos/${owner}/${name}/contents/${path}${branch ? `?ref=${encodeURIComponent(branch)}` : ''}`,
            { headers: headers(ctx) },
          );
          if (existing.ok && existing.data?.sha) sha = existing.data.sha;
          const body: Record<string, unknown> = {
            message: String(args.message || 'Update via RARE'),
            content: Buffer.from(String(args.content ?? ''), 'utf8').toString('base64'),
          };
          if (sha) body.sha = sha;
          if (branch) body.branch = branch;
          const res = await ctx.fetchJson<any>(`${API}/repos/${owner}/${name}/contents/${path}`, {
            method: 'PUT',
            headers: { ...headers(ctx), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) return done({ ok: false, action: actionId, error: describeFailure(res.status, res.text), httpStatus: res.status });
          return done({
            ok: true,
            action: actionId,
            httpStatus: res.status,
            data: { path, commit: res.data?.commit?.sha, updated: Boolean(sha) },
          });
        }
        case 'create_issue': {
          const { owner, name } = splitRepo(String(args.repo));
          const res = await ctx.fetchJson<any>(`${API}/repos/${owner}/${name}/issues`, {
            method: 'POST',
            headers: { ...headers(ctx), 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: String(args.title || ''), body: String(args.body || '') }),
          });
          if (!res.ok) return done({ ok: false, action: actionId, error: describeFailure(res.status, res.text), httpStatus: res.status });
          return done({
            ok: true,
            action: actionId,
            httpStatus: res.status,
            data: { number: res.data?.number, url: res.data?.html_url, title: res.data?.title },
          });
        }
        case 'list_issues': {
          const { owner, name } = splitRepo(String(args.repo));
          const res = await ctx.fetchJson<any[]>(`${API}/repos/${owner}/${name}/issues?state=all&per_page=30`, {
            headers: headers(ctx),
          });
          if (!res.ok) return done({ ok: false, action: actionId, error: describeFailure(res.status, res.text), httpStatus: res.status });
          return done({
            ok: true,
            action: actionId,
            httpStatus: res.status,
            data: (res.data || []).map((i) => ({ number: i.number, title: i.title, state: i.state })),
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
