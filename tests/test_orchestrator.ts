/**
 * Regression tests for the canonical orchestrator.
 *
 * These assert the *routing decision*, which is what enforces the permission
 * boundary. The critical property: a request that would modify RARE's own
 * source must never be classified as an ordinary user project build, because
 * that path has no developer gate.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { routeRequest } from '../src/server/orchestrator/IntentRouter.js';
import { planPatches } from '../src/server/orchestrator/PatchPlanner.js';

let pass = 0;
let fail = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    pass += 1;
    console.log(`  PASS  ${name}`);
  } catch (error: any) {
    fail += 1;
    console.error(`  FAIL  ${name} — ${error?.message || error}`);
  }
}

export async function runOrchestratorTests() {
  console.log('[Test Group] Canonical orchestrator: routing and patch planning');

  // --- routing: ordinary user work stays unprivileged ---------------------
  check('an ordinary app build routes to project_build without a developer gate', () => {
    const d = routeRequest('build me a todo app with login');
    assert.strictEqual(d.capability, 'project_build');
    assert.strictEqual(d.requiresDeveloper, false);
    assert.strictEqual(d.targetsRareItself, false);
  });

  check('a research request routes to research', () => {
    const d = routeRequest('research the latest approaches to vector search');
    assert.strictEqual(d.capability, 'research');
    assert.strictEqual(d.requiresDeveloper, false);
  });

  check('a document lookup routes to documents', () => {
    const d = routeRequest('find the document about the Q3 budget');
    assert.strictEqual(d.capability, 'documents');
  });

  check('a plain question routes to conversation', () => {
    const d = routeRequest('what is the capital of France?');
    assert.strictEqual(d.capability, 'conversation');
    assert.strictEqual(d.requiresDeveloper, false);
  });

  // --- routing: self-modification is always developer-gated ---------------
  check('modifying RARE source routes to self_build and requires a developer', () => {
    const d = routeRequest('fix the retry logic in src/server/tools/ToolExecutor.ts');
    assert.strictEqual(d.capability, 'self_build');
    assert.strictEqual(d.requiresDeveloper, true);
    assert.strictEqual(d.targetsRareItself, true);
  });

  check('"change your own code" is treated as self_build, not project_build', () => {
    const d = routeRequest('change your own code so the sidebar collapses');
    assert.strictEqual(d.capability, 'self_build');
    assert.strictEqual(d.requiresDeveloper, true);
  });

  check('a self-referential question is conversation, not a privileged action', () => {
    const d = routeRequest('how does your memory work?');
    assert.strictEqual(d.capability, 'conversation');
    assert.strictEqual(d.requiresDeveloper, false);
  });

  check('diagnostics about RARE require a developer session', () => {
    const d = routeRequest('run the self-test and diagnose why the API is failing');
    assert.strictEqual(d.capability, 'diagnostics');
    assert.strictEqual(d.requiresDeveloper, true);
  });

  check('a release request requires a developer session', () => {
    const d = routeRequest('publish a new RARE release to the public channel');
    assert.strictEqual(d.capability, 'release');
    assert.strictEqual(d.requiresDeveloper, true);
  });

  check('an empty request is conversation with full confidence', () => {
    const d = routeRequest('   ');
    assert.strictEqual(d.capability, 'conversation');
    assert.strictEqual(d.confidence, 1);
  });

  // --- patch planner: grounded changes only -------------------------------
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-planner-'));
  const previousRoot = process.env.RARE_APP_ROOT;
  process.env.RARE_APP_ROOT = workspace;

  try {
    fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, 'src', 'sample.ts'),
      "import { thing } from './thing.js';\n\nexport function run() {\n  return thing();\n}\n",
      'utf8',
    );

    check('a named file with a fenced block produces a real modify patch', () => {
      const plan = planPatches(
        'add a guard to src/sample.ts\n```ts\nif (!thing) throw new Error("missing");\n```',
      );
      assert.strictEqual(plan.patches.length, 1, plan.blocker || 'expected one patch');
      const patch = plan.patches[0];
      assert.strictEqual(patch.operation, 'modify');
      assert.strictEqual(patch.path, 'src/sample.ts');
      // The anchor must be text that actually exists in the file.
      const content = fs.readFileSync(path.join(workspace, 'src', 'sample.ts'), 'utf8');
      assert.ok(content.includes(patch.search!), 'search block must exist verbatim in the file');
      assert.ok(patch.replace!.includes('missing'), 'replacement must carry the requested code');
    });

    check('a request naming no file returns a blocker instead of a guess', () => {
      const plan = planPatches('make the app faster');
      assert.strictEqual(plan.patches.length, 0);
      assert.ok(plan.blocker && plan.blocker.length > 0, 'a blocker must explain why');
    });

    check('a request naming a missing file returns a blocker', () => {
      const plan = planPatches('fix src/does-not-exist.ts');
      assert.strictEqual(plan.patches.length, 0);
      assert.match(plan.blocker || '', /not found/i);
    });

    check('the planner never proposes a path outside the editable roots', () => {
      const plan = planPatches('fix ../../etc/passwd');
      assert.strictEqual(plan.patches.length, 0);
    });

    check('creating a new file requires an explicit body', () => {
      const withoutBody = planPatches('create src/new-file.ts');
      assert.strictEqual(withoutBody.patches.length, 0);
      assert.match(withoutBody.blocker || '', /fenced code block/i);

      const withBody = planPatches('create src/new-file.ts\n```ts\nexport const x = 1;\n```');
      assert.strictEqual(withBody.patches.length, 1);
      assert.strictEqual(withBody.patches[0].operation, 'create');
      assert.match(withBody.patches[0].replace || '', /export const x = 1/);
    });
  } finally {
    if (previousRoot === undefined) delete process.env.RARE_APP_ROOT;
    else process.env.RARE_APP_ROOT = previousRoot;
    fs.rmSync(workspace, { recursive: true, force: true });
  }

  console.log(`  → ${pass} passed, ${fail} failed\n`);
  if (fail > 0) {
    throw new Error(`${fail} orchestrator assertion(s) failed.`);
  }
}
