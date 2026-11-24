#!/usr/bin/env node
/**
 * RARE deployment helper.
 *
 * Reads the Vercel token from the environment ONLY. It is never written to a
 * file, never echoed, and never included in output. If the token is missing the
 * script fails with an instruction rather than prompting for it, so it can run
 * unattended in CI.
 *
 * Usage:
 *   node scripts/deploy.mjs status
 *   node scripts/deploy.mjs preview <branch>
 *   node scripts/deploy.mjs promote <deployment-url-or-id>
 *   node scripts/deploy.mjs verify <url>
 *
 * Environment:
 *   VERCEL_TOKEN   required for every command except `verify`
 *   VERCEL_TEAM    defaults to mypremierai-2827
 *   VERCEL_PROJECT defaults to rareproject
 */

const TOKEN = process.env.VERCEL_TOKEN;
const TEAM = process.env.VERCEL_TEAM || 'mypremierai-2827';
const PROJECT = process.env.VERCEL_PROJECT || 'rareproject';
const API = 'https://api.vercel.com';

function requireToken() {
  if (!TOKEN) {
    console.error(
      'VERCEL_TOKEN is not set.\n' +
        'Export it in your shell (or your CI secret store) before running:\n' +
        '  export VERCEL_TOKEN=...   # never commit this value\n',
    );
    process.exit(2);
  }
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const msg = body?.error?.message || body?.error?.code || res.statusText;
    throw new Error(`${res.status} ${msg}`);
  }
  return body;
}

const q = `teamId=${encodeURIComponent(TEAM)}`;

async function status() {
  requireToken();
  const proj = await api(`/v9/projects/${PROJECT}?${q}`);
  const link = proj.link || {};
  console.log(`project        : ${proj.name}`);
  console.log(`framework      : ${proj.framework}`);
  console.log(`repo           : ${link.org}/${link.repo}`);
  console.log(`productionBranch: ${link.productionBranch}`);
  console.log(`nodeVersion    : ${proj.nodeVersion}`);

  const prod = proj.targets?.production;
  if (prod) {
    console.log(
      `production     : ${prod.readyState} ${prod.readySubstate || ''} @ ${(prod.meta?.githubCommitSha || '').slice(0, 9)} (${prod.meta?.githubCommitRef})`,
    );
  }
  const prev = proj.targets?.preview;
  if (prev) {
    console.log(
      `latest preview : ${prev.readyState} @ ${(prev.meta?.githubCommitSha || '').slice(0, 9)} (${prev.meta?.githubCommitRef})`,
    );
  }
}

async function preview(branch) {
  requireToken();
  if (!branch) {
    console.error('Usage: node scripts/deploy.mjs preview <branch>');
    process.exit(2);
  }
  const list = await api(`/v6/deployments?projectId=${PROJECT}&${q}&limit=50`);
  const match = (list.deployments || []).find(
    (d) => d.meta?.githubCommitRef === branch,
  );
  if (!match) {
    console.log(
      `No deployment found for branch "${branch}".\n` +
        'Pushing a commit to that branch triggers one automatically via the Git integration.',
    );
    return;
  }
  console.log(`branch   : ${branch}`);
  console.log(`state    : ${match.state}`);
  console.log(`commit   : ${(match.meta?.githubCommitSha || '').slice(0, 9)}`);
  console.log(`url      : https://${match.url}`);
}

async function promote(target) {
  requireToken();
  if (!target) {
    console.error('Usage: node scripts/deploy.mjs promote <deployment-url-or-id>');
    process.exit(2);
  }
  // Accept a full URL, a hostname, or a deployment id.
  let id = target.replace(/^https?:\/\//, '').split('/')[0];
  if (!id.startsWith('dpl_')) {
    const list = await api(`/v6/deployments?projectId=${PROJECT}&${q}&limit=100`);
    const found = (list.deployments || []).find(
      (d) => d.url === id || d.uid === id,
    );
    if (!found) throw new Error(`No deployment matches "${target}"`);
    id = found.uid;
  }
  const res = await api(`/v10/projects/${PROJECT}/promote/${id}?${q}`, {
    method: 'POST',
  });
  console.log(`promoted deployment ${id}`);
  console.log(`state: ${res.readyState || 'ok'}`);
  console.log(
    'The production alias now points at this deployment. Verify the live domain next.',
  );
}

async function verify(url) {
  if (!url) {
    console.error('Usage: node scripts/deploy.mjs verify <url>');
    process.exit(2);
  }
  const base = url.replace(/\/$/, '');
  const checks = [
    ['/', 'root'],
    ['/api/health', 'health'],
  ];
  let bad = 0;
  for (const [path, label] of checks) {
    try {
      const r = await fetch(base + path, { redirect: 'follow' });
      const ok = r.status === 200;
      if (!ok) bad++;
      let extra = '';
      if (path === '/api/health' && ok) {
        const j = await r.json().catch(() => ({}));
        extra = ` commit=${(j.commit_sha || '').slice(0, 9)} status=${j.status}`;
      }
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(7)} ${r.status}${extra}`);
    } catch (e) {
      bad++;
      console.log(`FAIL ${label.padEnd(7)} ${e.message}`);
    }
  }
  // The origin check that was broken: a preview must be able to open a session.
  try {
    const r = await fetch(base + '/api/user/guest-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: '{}',
    });
    const ok = r.status === 200;
    if (!ok) bad++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} origin  ${r.status} (guest-session from own origin)`);
  } catch (e) {
    bad++;
    console.log(`FAIL origin  ${e.message}`);
  }
  process.exit(bad === 0 ? 0 : 1);
}

const [cmd, arg] = process.argv.slice(2);
const run = { status, preview, promote, verify }[cmd];
if (!run) {
  console.error('Commands: status | preview <branch> | promote <url|id> | verify <url>');
  process.exit(2);
}
run(arg).catch((e) => {
  console.error(`error: ${e.message}`);
  process.exit(1);
});
