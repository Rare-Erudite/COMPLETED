/**
 * Regression tests for the canonical intent router.
 *
 * The defect these guard against: a self-build request that named a source file
 * ("fix src/server/tools/ToolExecutor.ts ...") was classified as ordinary
 * `conversation`, so it never reached the developer gate and never reached the
 * self-development engine. The phrase list only matched the literal word "rare".
 *
 * These assert the permission boundary, not that a function exists: an ordinary
 * build must stay unprivileged, and anything that can only mean this repository
 * must be self_build.
 */
import { routeChatIntent, capabilitiesForIntent } from '../src/server/chat/IntentRouter.js';

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

export function runIntentRouterTests(): void {
  console.log('=== Intent router: permission boundary ===');

  const intent = (t: string) => routeChatIntent(t).intent;

  // --- Ordinary work must stay unprivileged ---------------------------------
  check('an ordinary build is a build, not a self-build', intent('build me a todo app') === 'build');
  check(
    'a build naming a user project stays a build',
    intent('create a website called aurora') === 'build',
  );
  check('a plain question is a conversation', intent('how does your memory work?') === 'conversation');
  check('arithmetic is a conversation', intent('what is 2+2') === 'conversation');
  check('a greeting is a conversation', intent('hello there') === 'conversation');
  check('a research request is research', intent('research the latest on WebGPU') === 'research');
  check('a document request is documents', intent('read this document') === 'documents');

  // --- Self-reference must be caught ----------------------------------------
  check('a named source path is a self-build', intent('fix src/server/tools/ToolExecutor.ts so it logs better') === 'self_build');
  check('"your own code" is a self-build', intent('change your own code to add a health check') === 'self_build');
  check('"your source" is a self-build', intent('modify your source to add a route') === 'self_build');
  check('"improve rare" is a self-build', intent('improve rare') === 'self_build');
  check('a root file is a self-build', intent('update server.ts to add a health route') === 'self_build');
  check('a tests path is a self-build', intent('add a test in tests/test_foo.ts') === 'self_build');
  check('"this repository" is a self-build', intent('clean up this repository') === 'self_build');

  // --- The boundary must not over-trigger -----------------------------------
  check(
    'a user project path is not a self-build',
    intent('build an app with src/main.tsx') !== 'self_build',
    intent('build an app with src/main.tsx'),
  );
  check(
    'asking about the codebase is not a self-build',
    intent('how does your memory work?') !== 'self_build',
  );

  // --- Capability mapping ---------------------------------------------------
  const buildCaps = capabilitiesForIntent(routeChatIntent('build me a todo app'));
  check('a build maps to builder capabilities', buildCaps.some((c) => c.startsWith('builder.')), buildCaps.join(','));
  const selfCaps = capabilitiesForIntent(routeChatIntent('improve rare'));
  check(
    'a self-build does not map to an unprivileged builder capability',
    !selfCaps.includes('builder.deliver'),
    selfCaps.join(','),
  );

  console.log(`\nIntent router: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

if (process.argv[1] && process.argv[1].includes('test_intent_router')) {
  runIntentRouterTests();
}
