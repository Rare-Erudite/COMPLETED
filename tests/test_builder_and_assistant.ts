/**
 * Unit tests for the builder toolchain registry and the assistant command
 * interpreter. Both are pure logic + local process probing, so they run without
 * a live server or external network access, and they assert the honest-reporting
 * property: an unavailable tool must never appear as ready.
 */

import assert from 'node:assert/strict';
import { detectToolchains, getCachedToolchains } from '../src/server/builder/ToolchainRegistry.js';

const VALID_STATUSES = new Set(['ready', 'version_mismatch', 'missing', 'probe_failed']);

export async function runToolchainRegistryTests() {
  console.log('--- Testing builder toolchain detection ---');

  const capabilities = await detectToolchains(true);

  assert.ok(Array.isArray(capabilities) && capabilities.length >= 5, 'Probes at least five toolchains');

  const ids = new Set<string>();
  for (const capability of capabilities) {
    assert.equal(typeof capability.id, 'string', 'Every entry has a string id');
    assert.ok(!ids.has(capability.id), `Toolchain ids are unique (duplicate: ${capability.id})`);
    ids.add(capability.id);

    assert.ok(VALID_STATUSES.has(capability.status), `Status is one of the known values (${capability.id})`);
    assert.ok(Array.isArray(capability.domains), `Domains is an array (${capability.id})`);

    // The honest-reporting invariant: `detected` must agree with `status`.
    if (capability.status === 'ready' || capability.status === 'version_mismatch') {
      assert.equal(capability.detected, true, `${capability.id} reports detected when status is ${capability.status}`);
      assert.ok(capability.version, `${capability.id} exposes a version when it is usable`);
    } else {
      assert.equal(capability.detected, false, `${capability.id} must not claim detection when ${capability.status}`);
      assert.equal(capability.version, null, `${capability.id} has no version when unavailable`);
      assert.ok(capability.installHint, `${capability.id} explains what to install when unavailable`);
    }
  }

  // Node must be present in this project's own toolchain, or nothing could run.
  const node = capabilities.find((entry) => entry.id === 'node_ts');
  assert.ok(node, 'Node.js probe is present');
  assert.equal(node!.status, 'ready', 'Node.js is detected as ready on the machine running these tests');
  assert.match(String(node!.version), /^Node \d+\.\d+\.\d+$/, 'Node version is parsed from real output');

  // A genuinely absent tool must report missing, not a fabricated version.
  const docker = capabilities.find((entry) => entry.id === 'docker');
  assert.ok(docker, 'Docker probe is present');
  assert.ok(
    ['ready', 'missing', 'probe_failed'].includes(docker!.status),
    'Docker is either genuinely ready or honestly unavailable'
  );
  if (docker!.status !== 'ready') {
    assert.equal(docker!.detected, false);
    assert.equal(docker!.version, null);
  }

  // Caching: a second call without force returns the same object identity.
  const cached = getCachedToolchains();
  assert.ok(cached, 'Cache is warm after a forced detection run');
  const again = await detectToolchains();
  assert.equal(again, cached, 'Unforced call reuses the cached detection result');

  console.log(`  ✓ ${capabilities.length} toolchains probed, ${capabilities.filter((c) => c.status === 'ready').length} ready`);
}

// ---------------------------------------------------------------------------
// Assistant command interpretation — mirrored from AssistantStudioView so the
// routing rules are covered without importing a React component in Node tests.
// ---------------------------------------------------------------------------

type CommandIntent =
  | { kind: 'documents'; query: string }
  | { kind: 'research'; query: string }
  | { kind: 'build'; objective: string }
  | { kind: 'read_url'; url: string }
  | { kind: 'unknown' };

function interpretCommand(raw: string): CommandIntent {
  const text = raw.trim();
  if (!text) return { kind: 'unknown' };

  const urlMatch = text.match(/https?:\/\/[^\s]+/i);
  if (urlMatch && /(read|open|fetch|summar|investigat|check|analys|analyze)/i.test(text)) {
    return { kind: 'read_url', url: urlMatch[0] };
  }

  if (/(document|file|docx|pdf|note|transcript)/i.test(text)) {
    return {
      kind: 'documents',
      query:
        text
          .replace(/^(find|search|open|look up|locate)\s+(a\s+|an\s+|the\s+)?(document|file)s?\s*(about|for)?\s*/i, '')
          .trim() || text,
    };
  }

  if (/(research|investigate|compare|find out|look up|sources?|evidence)/i.test(text)) {
    return {
      kind: 'research',
      query: text.replace(/^(research|investigate|compare|find out about|look up)\s+/i, '').trim() || text,
    };
  }

  if (/(build|create an app|scaffold|implement|make an application|develop)/i.test(text)) {
    return { kind: 'build', objective: text };
  }

  return { kind: 'unknown' };
}

export async function runAssistantCommandTests() {
  console.log('--- Testing assistant command interpretation ---');

  assert.equal(interpretCommand('').kind, 'unknown', 'Empty input maps to no action');
  assert.equal(interpretCommand('   ').kind, 'unknown', 'Whitespace-only input maps to no action');

  const url = interpretCommand('Read https://example.com/report and summarise it');
  assert.equal(url.kind, 'read_url');
  assert.equal((url as { url: string }).url, 'https://example.com/report');

  const bareUrl = interpretCommand('https://example.com');
  assert.equal(bareUrl.kind, 'unknown', 'A bare URL without an action verb is not auto-fetched');

  const doc = interpretCommand('Find the document about our project');
  assert.equal(doc.kind, 'documents');
  assert.equal((doc as { query: string }).query, 'our project', 'Leading verb and noun are stripped from the query');

  const research = interpretCommand('Research Rust vs Go for CLI tooling');
  assert.equal(research.kind, 'research');
  assert.equal((research as { query: string }).query, 'Rust vs Go for CLI tooling');

  const buildIntent = interpretCommand('Build an app that tracks expenses');
  assert.equal(buildIntent.kind, 'build');

  // Ambiguity rule: URL + verb wins over topic keywords, so a link is fetched
  // rather than a document search being guessed.
  const both = interpretCommand('Check https://example.com/doc for the project document');
  assert.equal(both.kind, 'read_url', 'Explicit URL with an action verb takes priority');

  const nonsense = interpretCommand('make me a sandwich');
  assert.equal(nonsense.kind, 'unknown', 'Unsupported requests are not silently mapped to a real action');

  const cases = ['Read https://a.test', 'Find the file', 'Investigate this claim', 'Build a CLI'];
  for (const input of cases) {
    const intent = interpretCommand(input);
    assert.notEqual(intent.kind, 'unknown', `"${input}" resolves to a concrete intent`);
  }

  console.log(`  ✓ ${cases.length + 8} interpretation cases verified`);
}

/**
 * Regression: `/api/builder/toolchains` used to serve a hardcoded array that
 * advertised `detected: true` for Node, Vite, Python, Android/Gradle, an MSVC
 * "Windows toolchain" and Rust — regardless of what the host actually had. It
 * reported versions the machine had never run (Python 3.13.2 / Cargo 1.84 on a
 * Python 3.11 host with no Cargo at all), and claimed an MSVC toolchain on Linux.
 *
 * The route must now serve the result of real `--version` probes: same entries
 * as detectToolchains(), and any entry reported ready must carry a real version.
 */
export async function runToolchainRouteTests() {
  console.log('--- Testing /api/builder/toolchains serves real detection ---');

  const base = process.env.RARE_TEST_BASE_URL || 'http://127.0.0.1:3000';

  // The route is session-gated (it exposes host tooling), so sign up first.
  const signup = await fetch(`${base}/api/user/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({
      email: `toolchain-route-${Date.now()}@rare-verify.test`,
      password: 'ToolchainRouteTest2026',
      name: 'Toolchain Route',
    }),
  });
  assert.equal(signup.status, 200, 'Test signup succeeds');

  const rawCookies = typeof (signup.headers as any).getSetCookie === 'function'
    ? (signup.headers as any).getSetCookie() as string[]
    : (signup.headers.get('set-cookie') || '').split(/, (?=[^;,]+=)/g);
  const cookies = rawCookies.map((value) => value.split(';', 1)[0]).filter(Boolean);
  const csrf = signup.headers.get('x-csrf-token') || '';
  assert.ok(cookies.length && csrf, 'Signup issues a session cookie and CSRF token');

  const response = await fetch(`${base}/api/builder/toolchains`, {
    headers: { Cookie: cookies.join('; '), Origin: base, 'X-CSRF-Token': decodeURIComponent(csrf) },
  });
  assert.equal(response.status, 200, 'Toolchain route responds 200 to an authenticated user');

  const body = await response.json() as any[];
  assert.ok(Array.isArray(body), 'Toolchain route returns an array');

  const probed = await detectToolchains();
  assert.equal(
    body.length,
    probed.length,
    'Route reports exactly the probed set, not a separate hardcoded list'
  );

  const byId = new Map(body.map((entry: any) => [entry.id, entry]));
  for (const capability of probed) {
    const served = byId.get(capability.id);
    assert.ok(served, `Route includes probed toolchain ${capability.id}`);
    assert.equal(served.status, capability.status, `${capability.id} status matches the probe`);
    assert.equal(served.detected, capability.detected, `${capability.id} detected matches the probe`);
  }

  // The specific fabrication that was removed: an MSVC/Windows toolchain cannot
  // be probed on this host and must not be advertised.
  assert.ok(
    !byId.has('windows_toolchain'),
    'No fabricated Windows/MSVC toolchain is advertised'
  );

  // Honest-reporting invariant, asserted through the HTTP surface.
  for (const entry of body as any[]) {
    if (entry.status === 'ready' || entry.status === 'version_mismatch') {
      assert.equal(entry.detected, true, `${entry.id} ready implies detected`);
      assert.ok(entry.version, `${entry.id} exposes a real version when ready`);
    } else {
      assert.equal(entry.detected, false, `${entry.id} unavailable implies not detected`);
      assert.equal(entry.version, null, `${entry.id} has no version when unavailable`);
    }
  }

  console.log(`  ✓ ${body.length} route entries match real probes; no fabricated toolchains`);
}
