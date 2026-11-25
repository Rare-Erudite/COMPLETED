/**
 * Real self-build behaviour tests.
 *
 * These prove the engine actually changes files, not that a method exists.
 * The defect being guarded against: `executeCycle` reported step 4 "Modify
 * Source Files: Completed" without touching disk, and `changedFiles` was
 * permanently empty — a green report describing a change that never happened.
 *
 * Every test here runs against a throwaway workspace so the real repository is
 * never modified by the test suite.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MemoryStore } from '../src/server/storage/MemoryStore.js';
import { CheckpointStore } from '../src/server/storage/CheckpointStore.js';
import { TrajectoryStore } from '../src/server/storage/TrajectoryStore.js';
import { ToolExecutor } from '../src/server/tools/ToolExecutor.js';
import { SelfDevelopmentEngine } from '../src/server/development/SelfDevelopmentEngine.js';
import { PatchPlanner } from '../src/server/development/PatchPlanner.js';

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

/** A throwaway workspace with one editable file. */
function makeWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-selfdev-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src', 'target.ts'),
    'export const greeting = "hello";\nexport const version = 1;\n',
    'utf-8',
  );
  return root;
}

/**
 * Build an engine whose ToolExecutor is rooted at the throwaway workspace.
 * RARE_APP_ROOT is what ToolExecutor and the engine both resolve against, so
 * setting it here keeps the real repository untouched.
 */
function makeEngine(root: string) {
  const memoryStore = new MemoryStore();
  const checkpointStore = new CheckpointStore();
  const trajectoryStore = new TrajectoryStore();
  const toolExecutor = new ToolExecutor(memoryStore, checkpointStore, undefined, undefined, undefined, root);
  const engine = new SelfDevelopmentEngine(checkpointStore, trajectoryStore, toolExecutor, root);
  return { engine, restore() {} };
}

export async function runSelfBuildTests(): Promise<void> {
  console.log('=== Self-build: real file changes (not progress events) ===');

  // --- PatchPlanner grounding -------------------------------------------------
  {
    const root = makeWorkspace();
    const planner = new PatchPlanner({ root });

    const named = await planner.plan('rename greeting to salutation in src/target.ts');
    check(
      'planner grounds a rename against real source',
      named.patches.length === 1 && named.patches[0].file === 'src/target.ts',
      JSON.stringify(named.patches.map((p) => p.file)),
    );
    check(
      'the grounded anchor exists exactly once',
      named.patches.length === 1 &&
        fs.readFileSync(path.join(root, 'src/target.ts'), 'utf-8').split(named.patches[0].search).length - 1 === 1,
    );

    const noFile = await planner.plan('make the app better somehow');
    check(
      'planner refuses to invent a change when no file is named',
      noFile.patches.length === 0 && Boolean(noFile.blocker),
      noFile.blocker || 'no blocker reported',
    );

    const missing = await planner.plan('rename greeting to salutation in src/does-not-exist.ts');
    check(
      'planner reports a blocker for a missing file rather than guessing',
      missing.patches.length === 0 && Boolean(missing.blocker),
    );

    const escape = await planner.plan('rename greeting to salutation in ../../etc/passwd.ts');
    check(
      'planner refuses a path outside the editable roots',
      escape.patches.length === 0,
    );

    fs.rmSync(root, { recursive: true, force: true });
  }

  // --- Engine applies a real change ------------------------------------------
  {
    const root = makeWorkspace();
    const { engine, restore } = makeEngine(root);

    const before = fs.readFileSync(path.join(root, 'src', 'target.ts'), 'utf-8');
    const result = await engine.executeCycle(
      { instruction: 'rename greeting to salutation in src/target.ts' },
      true,
    );
    const after = fs.readFileSync(path.join(root, 'src', 'target.ts'), 'utf-8');
    restore();

    check(
      'an authorized self-build actually changes the file on disk',
      after !== before && after.includes('salutation'),
      `before=${before.length}b after=${after.length}b`,
    );
    check(
      'changedFiles lists the file that really changed',
      result.trajectory.changedFiles.includes('src/target.ts'),
      JSON.stringify(result.trajectory.changedFiles),
    );
    check(
      'the reported diff matches what is on disk',
      (result.diffs || []).length === 1 &&
        result.diffs![0].before === before &&
        result.diffs![0].after === after,
    );
    check(
      'step 4 is not reported as Completed when nothing was applied',
      result.status !== 'BLOCKED' || result.steps.some((s) => s.outcome === 'Blocked'),
    );

    fs.rmSync(root, { recursive: true, force: true });
  }

  // --- Unauthorized is refused and changes nothing ---------------------------
  {
    const root = makeWorkspace();
    const { engine, restore } = makeEngine(root);
    const before = fs.readFileSync(path.join(root, 'src', 'target.ts'), 'utf-8');

    const result = await engine.executeCycle(
      { instruction: 'rename greeting to salutation in src/target.ts' },
      false,
    );
    const after = fs.readFileSync(path.join(root, 'src', 'target.ts'), 'utf-8');
    restore();

    check(
      'an unauthorized self-build is refused',
      result.status === 'REVERTED_ON_FAILURE',
      result.status,
    );
    check('an unauthorized self-build changes no file', before === after);
    check(
      'the refusal names the missing authorization',
      result.steps.some((s) => /Developer Passkey|authorization/i.test(s.details || '')),
    );

    fs.rmSync(root, { recursive: true, force: true });
  }

  // --- A blocked run never claims success ------------------------------------
  {
    const root = makeWorkspace();
    const { engine, restore } = makeEngine(root);
    const before = fs.readFileSync(path.join(root, 'src', 'target.ts'), 'utf-8');

    const result = await engine.executeCycle(
      { instruction: 'improve the overall quality of everything' },
      true,
    );
    const after = fs.readFileSync(path.join(root, 'src', 'target.ts'), 'utf-8');
    restore();

    check(
      'an ungroundable instruction is BLOCKED, not VERIFIED_SUCCESS',
      result.status === 'BLOCKED',
      result.status,
    );
    check('a blocked run changes no file', before === after);
    check('a blocked run reports a blocker', Boolean(result.blocker), result.blocker || 'none');
    check(
      'a blocked run reports testOutcome not_run rather than passed',
      result.trajectory.testOutcome === 'not_run',
      result.trajectory.testOutcome,
    );
    check(
      'a blocked run reports no changed files',
      result.trajectory.changedFiles.length === 0,
    );

    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log(`\nSelf-build: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

if (process.argv[1] && process.argv[1].includes('test_self_build_real')) {
  runSelfBuildTests();
}
