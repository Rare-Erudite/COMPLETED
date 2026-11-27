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

  // --- Device, schedule and plugin routing ---------------------------------
  // These are the intents that previously fell through to conversation, so a
  // request to act on the phone was answered with prose instead of executed.
  check('"open WhatsApp" routes to device', intent('Open WhatsApp') === 'device', intent('Open WhatsApp'));
  check('"describe my screen" routes to device', intent('Describe what is on my screen') === 'device', intent('Describe what is on my screen'));
  check('"scroll down" routes to device', intent('Scroll down') === 'device', intent('Scroll down'));
  check('"check my notifications" routes to device', intent('Check my notifications') === 'device', intent('Check my notifications'));
  check('"turn on wifi" routes to device', intent('Open Settings and turn on Wi-Fi') === 'device', intent('Open Settings and turn on Wi-Fi'));

  check('"remind me every morning" routes to schedule', intent('Remind me every morning') === 'schedule', intent('Remind me every morning'));
  check('"every two minutes" routes to schedule', intent('Every two minutes, check WhatsApp for new messages') === 'schedule', intent('Every two minutes, check WhatsApp for new messages'));
  check('"pause my reminder" routes to schedule', intent('Pause my existing reminder') === 'schedule', intent('Pause my existing reminder'));
  check('"in 30 minutes" routes to schedule', intent('In 30 minutes, remind me to check this document') === 'schedule', intent('In 30 minutes, remind me to check this document'));

  check('"use the connected plugin" routes to plugin', intent('Use the connected plugin to perform this task') === 'plugin', intent('Use the connected plugin to perform this task'));
  check('"list my plugins" routes to plugin', intent('List my plugins') === 'plugin', intent('List my plugins'));

  // A recurring device monitor is a schedule, not a one-off device action.
  check(
    'a recurring device check is a schedule, not a device action',
    intent('Check my notifications every 5 minutes') === 'schedule',
    intent('Check my notifications every 5 minutes'),
  );

  // The new intents must not steal ordinary conversation.
  check('a question about WhatsApp is not a device action', intent('what is WhatsApp?') === 'conversation', intent('what is WhatsApp?'));
  check('a question about reminders is not a schedule', intent('how do reminders work?') === 'conversation', intent('how do reminders work?'));

  // Capability mapping for the new intents. These assert against the ids that
  // are actually registered in registerCapabilities.ts — a mapping to a
  // capability that does not exist would be filtered out at runtime and the
  // request would silently fall back to conversation.
  check('device maps to a device capability', capabilitiesForIntent(routeChatIntent('Open WhatsApp')).includes('device.plan'));
  check('schedule maps to a scheduler capability', capabilitiesForIntent(routeChatIntent('Remind me every morning')).includes('scheduler.manage'));
  check('plugin maps to a plugin capability', capabilitiesForIntent(routeChatIntent('List my plugins')).includes('plugins.list'));

  console.log(`\nIntent router: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

if (process.argv[1] && process.argv[1].includes('test_intent_router')) {
  runIntentRouterTests();
}
