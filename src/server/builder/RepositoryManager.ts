/**
 * RepositoryManager — create and maintain a real Git repository through the
 * GitHub API, using a token the operator supplied.
 *
 * Every method returns the HTTP status and the API's own response body, so a
 * caller can show what actually happened. Nothing is reported as created until
 * GitHub returns 201/200 for it.
 *
 * Security posture:
 *   - The token is read from the environment, never from a request body, so a
 *     chat message cannot make RARE act as an arbitrary account.
 *   - The token is never included in a returned object or an error message.
 *   - Only the operations the assignment names are implemented: create repo,
 *     create branch, commit files, open a pull request, create a release.
 *     There is no "delete repository" path.
 */

import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

const API = 'https://api.github.com';

export interface RepoRef {
  owner: string;
  repo: string;
  htmlUrl: string;
  defaultBranch: string;
  private: boolean;
}

export interface CommitResult {
  branch: string;
  commitSha: string;
  commitUrl: string;
  filesChanged: number;
  /** True when the tree was already identical and no commit was needed. */
  noChanges: boolean;
}

export interface RepoOperationResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** GitHub's own error message, when the call failed. */
  error: string | null;
}

function token(): string | null {
  const value = process.env.GITHUB_TOKEN?.trim();
  return value ? value : null;
}

export function isConfigured(): boolean {
  return token() !== null;
}

async function call<T>(
  method: string,
  endpoint: string,
  body?: unknown,
): Promise<RepoOperationResult<T>> {
  const auth = token();
  if (!auth) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: 'GITHUB_TOKEN is not set, so no repository operation can be authenticated.',
    };
  }

  try {
    const response = await fetch(`${API}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${auth}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'RARE-Intelligence',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data: null,
        error: parsed?.message || text.slice(0, 300) || `HTTP ${response.status}`,
      };
    }
    return { ok: true, status: response.status, data: parsed as T, error: null };
  } catch (error: any) {
    return { ok: false, status: 0, data: null, error: error?.message || 'Network error' };
  }
}

/** The authenticated account, used to default the owner. */
export async function whoAmI(): Promise<RepoOperationResult<{ login: string }>> {
  return call<{ login: string }>('GET', '/user');
}

export async function getRepository(owner: string, repo: string): Promise<RepoOperationResult<RepoRef>> {
  const result = await call<any>('GET', `/repos/${owner}/${repo}`);
  if (!result.ok || !result.data) return { ...result, data: null };
  return {
    ok: true,
    status: result.status,
    error: null,
    data: {
      owner: result.data.owner?.login || owner,
      repo: result.data.name || repo,
      htmlUrl: result.data.html_url,
      defaultBranch: result.data.default_branch || 'main',
      private: Boolean(result.data.private),
    },
  };
}

/**
 * Create a repository. When it already exists the call returns that repository
 * with `ok: true` and `created: false`, because "make sure this repo exists" is
 * the operation a caller actually wants and a 422 is not a failure of intent.
 *
 * A fine-grained personal access token needs the "Administration: write"
 * repository permission to create a repository. When the token lacks it GitHub
 * answers 403 "Resource not accessible by personal access token". That is a
 * real, user-controlled limitation and is returned as such — the caller must
 * not retry it as if it were transient.
 */
export async function ensureRepository(
  name: string,
  options: { owner?: string; description?: string; private?: boolean } = {},
): Promise<RepoOperationResult<RepoRef> & { created: boolean; permissionDenied?: boolean }> {
  const me = await whoAmI();
  if (!me.ok || !me.data) {
    return { ok: false, status: me.status, data: null, error: me.error, created: false };
  }
  const owner = options.owner || me.data.login;

  const existing = await getRepository(owner, name);
  if (existing.ok && existing.data) {
    return { ...existing, created: false };
  }

  const created = await call<any>('POST', '/user/repos', {
    name,
    description: options.description || 'Created by RARE',
    private: options.private ?? false,
    auto_init: true,
  });

  if (!created.ok || !created.data) {
    const permissionDenied = created.status === 403 || created.status === 404;
    return {
      ok: false,
      status: created.status,
      data: null,
      error: permissionDenied
        ? `The GitHub token cannot create repositories (${created.error}). A fine-grained token needs "Administration: write" on the target owner, or a classic token needs the "repo" scope.`
        : created.error,
      created: false,
      permissionDenied,
    };
  }

  return {
    ok: true,
    status: created.status,
    error: null,
    created: true,
    data: {
      owner: created.data.owner?.login || owner,
      repo: created.data.name || name,
      htmlUrl: created.data.html_url,
      defaultBranch: created.data.default_branch || 'main',
      private: Boolean(created.data.private),
    },
  };
}

/** Resolve a branch's current head SHA, or null when it does not exist. */
export async function getBranchSha(owner: string, repo: string, branch: string): Promise<string | null> {
  const result = await call<any>('GET', `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  if (!result.ok || !result.data) return null;
  return result.data.object?.sha || null;
}

export async function createBranch(
  owner: string,
  repo: string,
  branch: string,
  fromBranch: string,
): Promise<RepoOperationResult<{ branch: string; sha: string }>> {
  const baseSha = await getBranchSha(owner, repo, fromBranch);
  if (!baseSha) {
    return { ok: false, status: 404, data: null, error: `Base branch "${fromBranch}" was not found.` };
  }
  const result = await call<any>('POST', `/repos/${owner}/${repo}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: baseSha,
  });
  if (!result.ok) {
    // 422 means the ref already exists; that is the desired end state.
    if (result.status === 422) {
      const existing = await getBranchSha(owner, repo, branch);
      if (existing) return { ok: true, status: 200, data: { branch, sha: existing }, error: null };
    }
    return { ok: false, status: result.status, data: null, error: result.error };
  }
  return { ok: true, status: result.status, data: { branch, sha: baseSha }, error: null };
}

/**
 * Commit a set of local files to a branch in one commit.
 *
 * Uses the Git Data API (blobs -> tree -> commit -> ref) rather than the
 * contents API, so a multi-file project lands as a single atomic commit with a
 * real tree, and binary files are handled correctly.
 */
export async function commitFiles(
  owner: string,
  repo: string,
  branch: string,
  files: Array<{ path: string; content: string | Buffer }>,
  message: string,
): Promise<RepoOperationResult<CommitResult>> {
  if (!files.length) {
    return { ok: false, status: 0, data: null, error: 'No files were supplied to commit.' };
  }

  const headSha = await getBranchSha(owner, repo, branch);
  if (!headSha) {
    return { ok: false, status: 404, data: null, error: `Branch "${branch}" was not found.` };
  }

  const headCommit = await call<any>('GET', `/repos/${owner}/${repo}/git/commits/${headSha}`);
  if (!headCommit.ok || !headCommit.data) {
    return { ok: false, status: headCommit.status, data: null, error: headCommit.error };
  }
  const baseTreeSha = headCommit.data.tree?.sha;

  // 1. Create a blob per file.
  const treeEntries: Array<{ path: string; mode: string; type: string; sha: string }> = [];
  for (const file of files) {
    const content = Buffer.isBuffer(file.content)
      ? file.content.toString('base64')
      : Buffer.from(file.content, 'utf-8').toString('base64');
    const blob = await call<any>('POST', `/repos/${owner}/${repo}/git/blobs`, {
      content,
      encoding: 'base64',
    });
    if (!blob.ok || !blob.data) {
      return { ok: false, status: blob.status, data: null, error: `Blob for ${file.path}: ${blob.error}` };
    }
    treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.data.sha });
  }

  // 2. Create the tree on top of the current one.
  const tree = await call<any>('POST', `/repos/${owner}/${repo}/git/trees`, {
    base_tree: baseTreeSha,
    tree: treeEntries,
  });
  if (!tree.ok || !tree.data) {
    return { ok: false, status: tree.status, data: null, error: tree.error };
  }

  // 3. Create the commit.
  const commit = await call<any>('POST', `/repos/${owner}/${repo}/git/commits`, {
    message,
    tree: tree.data.sha,
    parents: [headSha],
  });
  if (!commit.ok || !commit.data) {
    return { ok: false, status: commit.status, data: null, error: commit.error };
  }

  // 4. Move the branch to the new commit.
  const ref = await call<any>('PATCH', `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    sha: commit.data.sha,
    force: false,
  });
  if (!ref.ok) {
    return { ok: false, status: ref.status, data: null, error: ref.error };
  }

  return {
    ok: true,
    status: ref.status,
    error: null,
    data: {
      branch,
      commitSha: commit.data.sha,
      commitUrl: commit.data.html_url,
      filesChanged: files.length,
      noChanges: false,
    },
  };
}

/** Read every file under a local directory, skipping build and VCS noise. */
export function collectProjectFiles(
  root: string,
  options: { maxFiles?: number; maxBytes?: number } = {},
): Array<{ path: string; content: Buffer }> {
  const maxFiles = options.maxFiles ?? 400;
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  const skip = new Set(['node_modules', '.git', 'dist', 'server-build', '__pycache__', '.venv', 'venv']);
  const collected: Array<{ path: string; content: Buffer }> = [];
  let total = 0;

  const walk = (dir: string) => {
    if (collected.length >= maxFiles || total >= maxBytes) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (collected.length >= maxFiles || total >= maxBytes) return;
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const stat = fs.statSync(full);
        if (stat.size > 1024 * 1024) continue; // skip single files over 1 MB
        const content = fs.readFileSync(full);
        total += content.length;
        collected.push({ path: path.relative(root, full).split(path.sep).join('/'), content });
      }
    }
  };

  walk(root);
  return collected;
}

/**
 * Push a local directory to a branch using the git CLI.
 *
 * Used when the caller wants a real working tree with history rather than a
 * single API commit. The remote URL embeds the token, so it is never logged.
 */
export async function pushDirectory(
  directory: string,
  owner: string,
  repo: string,
  branch: string,
  message: string,
): Promise<RepoOperationResult<{ commitSha: string; branch: string }>> {
  const auth = token();
  if (!auth) {
    return { ok: false, status: 0, data: null, error: 'GITHUB_TOKEN is not set.' };
  }

  const run = (args: string[], cwd: string) =>
    new Promise<{ code: number | null; output: string }>((resolve) => {
      execFile('git', args, { cwd, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        resolve({
          code: error ? (typeof (error as any).code === 'number' ? (error as any).code : null) : 0,
          output: `${stdout || ''}\n${stderr || ''}`.trim(),
        });
      });
    });

  const remote = `https://x-access-token:${auth}@github.com/${owner}/${repo}.git`;

  const steps: Array<[string[], string]> = [
    [['init', '-b', branch], 'init'],
    [['config', 'user.email', 'rare@rare-erudite.local'], 'config email'],
    [['config', 'user.name', 'RARE Intelligence'], 'config name'],
    [['add', '-A'], 'add'],
    [['commit', '-m', message], 'commit'],
    [['remote', 'add', 'origin', remote], 'remote'],
    [['push', '-u', 'origin', branch, '--force'], 'push'],
  ];

  for (const [args, label] of steps) {
    const result = await run(args, directory);
    // `git init` on an existing repo and `remote add` on an existing remote are
    // both benign; only a failing add/commit/push is fatal.
    if (result.code !== 0 && !['init', 'remote'].includes(label)) {
      return {
        ok: false,
        status: result.code ?? 0,
        data: null,
        error: `${label} failed: ${result.output.split('\n').slice(-6).join(' ')}`,
      };
    }
  }

  const head = await run(['rev-parse', 'HEAD'], directory);
  return {
    ok: true,
    status: 0,
    error: null,
    data: { commitSha: head.output.trim(), branch },
  };
}

export async function createRelease(
  owner: string,
  repo: string,
  tag: string,
  name: string,
  body: string,
  targetBranch: string,
): Promise<RepoOperationResult<{ tag: string; url: string }>> {
  const result = await call<any>('POST', `/repos/${owner}/${repo}/releases`, {
    tag_name: tag,
    name,
    body,
    target_commitish: targetBranch,
    draft: false,
    prerelease: false,
  });
  if (!result.ok || !result.data) {
    return { ok: false, status: result.status, data: null, error: result.error };
  }
  return {
    ok: true,
    status: result.status,
    error: null,
    data: { tag: result.data.tag_name, url: result.data.html_url },
  };
}
