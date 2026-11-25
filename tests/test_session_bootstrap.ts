/**
 * Regression test: the client must bootstrap a session before calling any
 * session-gated API endpoint, not just /api/conversations.
 *
 * The defect this guards against: `isConversationApiRequest` matched only
 * /api/conversations, so the first /api/settings call on a cold load raced the
 * guest-session bootstrap and returned 401. That produced a console error on
 * every fresh visit and a settings panel that briefly showed defaults.
 *
 * This test reads the real source and asserts the guard is driven by the
 * public-path list, so a future endpoint added to the server's PUBLIC_API_PATHS
 * cannot silently reintroduce the race.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const apiSrc = fs.readFileSync(path.join(ROOT, 'src', 'api.ts'), 'utf8');
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8');

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

export function runSessionBootstrapTests(): void {
  console.log('=== Session bootstrap coverage (regression) ===');

  // The old narrow guard must be gone.
  check(
    'the conversations-only guard is gone',
    !/isConversationApiRequest/.test(apiSrc),
  );

  // The new guard must exist and be used at the call site.
  check(
    'a session-gated request predicate exists',
    /function isSessionGatedApiRequest\s*\(/.test(apiSrc),
  );
  check(
    'the predicate is used to gate the session bootstrap',
    /isSessionGatedApiRequest\(url\)[\s\S]{0,80}initializeGuestSessionToken\(\)/.test(apiSrc),
  );

  // The client's public-path list must match the server's, so the two cannot drift.
  function extractPaths(src: string, marker: string): Set<string> {
    const idx = src.indexOf(marker);
    if (idx === -1) return new Set();
    const slice = src.slice(idx, idx + 2000);
    const end = slice.indexOf(']);');
    const body = end === -1 ? slice : slice.slice(0, end);
    const found = body.match(/'\/api\/[^']+'/g) || [];
    return new Set(found.map((s) => s.replace(/'/g, '')));
  }

  const clientPaths = extractPaths(apiSrc, 'const PUBLIC_API_PATHS = new Set([');
  const serverPaths = extractPaths(serverSrc, 'const PUBLIC_API_PATHS = new Set([');

  check('client public-path list is non-empty', clientPaths.size > 0, `${clientPaths.size} paths`);
  check('server public-path list is non-empty', serverPaths.size > 0, `${serverPaths.size} paths`);

  const missingOnClient = [...serverPaths].filter((p) => !clientPaths.has(p));
  check(
    'every server-public path is also public on the client',
    missingOnClient.length === 0,
    missingOnClient.join(', '),
  );

  // The specific endpoint that regressed must be session-gated on the client.
  check(
    '/api/settings is treated as session-gated',
    !clientPaths.has('/api/settings'),
  );
  check(
    '/api/conversations is treated as session-gated',
    !clientPaths.has('/api/conversations'),
  );
  check(
    '/api/health stays public',
    clientPaths.has('/api/health'),
  );
  check(
    '/api/user/guest-session stays public (it is the bootstrap itself)',
    clientPaths.has('/api/user/guest-session'),
  );

  console.log(`\nSession bootstrap: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

// Allow running this file directly during development.
if (process.argv[1] && process.argv[1].includes('test_session_bootstrap')) {
  runSessionBootstrapTests();
}
