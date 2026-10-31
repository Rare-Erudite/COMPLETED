/**
 * Project & Build lifecycle tests.
 *
 * These assert the property the Universal Build flow previously lacked: it must
 * produce a REAL project on disk and be able to build and test it, reporting the
 * actual exit code. A scaffold that writes nothing, or a stage that reports
 * success without running, must fail these tests.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MemoryStore } from '../src/server/storage/MemoryStore.js';
import { CheckpointStore } from '../src/server/storage/CheckpointStore.js';
import { ToolExecutor } from '../src/server/tools/ToolExecutor.js';
import { scaffoldProject, PROJECT_TEMPLATES } from '../src/server/builder/ProjectScaffolder.js';

export async function runProjectBuildTests() {
  console.log('--- Testing Project & Build lifecycle ---');

  const memoryStore = new MemoryStore();
  const checkpointStore = new CheckpointStore();
  const toolExecutor = new ToolExecutor(memoryStore, checkpointStore);

  // 1. The scaffolder writes real files for every template.
  const workspace = process.cwd();
  for (const template of PROJECT_TEMPLATES) {
    const name = `test-scaffold-${template}`;
    const target = path.resolve(workspace, 'projects', name);
    fs.rmSync(target, { recursive: true, force: true });
    const result = scaffoldProject(workspace, name, template, 'regression test');
    assert.ok(result.files.length >= 2, `${template} writes at least two files`);
    for (const rel of result.files) {
      const full = path.resolve(workspace, rel);
      assert.ok(fs.existsSync(full), `${template} file exists on disk: ${rel}`);
      assert.ok(fs.statSync(full).size > 0, `${template} file is non-empty: ${rel}`);
    }
    fs.rmSync(target, { recursive: true, force: true });
  }
  console.log(`  \u2713 ${PROJECT_TEMPLATES.length} templates scaffold real, non-empty files`);

  // 2. Re-running against an existing project is refused (no clobbering).
  const dupName = 'test-scaffold-dup';
  const dupTarget = path.resolve(workspace, 'projects', dupName);
  fs.rmSync(dupTarget, { recursive: true, force: true });
  scaffoldProject(workspace, dupName, 'node-cli', 'first');
  assert.throws(
    () => scaffoldProject(workspace, dupName, 'node-cli', 'second'),
    /already exists/,
    'Scaffolding over an existing project is refused',
  );
  fs.rmSync(dupTarget, { recursive: true, force: true });
  console.log('  \u2713 existing projects are not overwritten');

  // 3. The SCAFFOLD_PROJECT tool writes a real project through the executor.
  const toolName = 'test-scaffold-tool';
  const toolTarget = path.resolve(workspace, 'projects', toolName);
  fs.rmSync(toolTarget, { recursive: true, force: true });
  const scaffoldRes = await toolExecutor.execute('SCAFFOLD_PROJECT', {
    name: toolName,
    template: 'node-cli',
    objective: 'a tool-driven project',
  });
  assert.equal(scaffoldRes.success, true, 'SCAFFOLD_PROJECT succeeds');
  assert.ok(fs.existsSync(path.join(toolTarget, 'package.json')), 'package.json written by the tool');
  assert.ok(fs.existsSync(path.join(toolTarget, 'src', 'index.js')), 'source written by the tool');

  // 4. RUN_PROJECT_STAGE runs the real test stage and reports the real exit code.
  const testStage = await toolExecutor.execute('RUN_PROJECT_STAGE', { project: toolName, stage: 'test' });
  assert.equal(testStage.success, true, 'The generated project test stage passes');
  assert.equal(testStage.output.exitCode, 0, 'The test stage reports exit code 0');
  assert.match(String(testStage.output.stdout), /tests passed/, 'The real test output is returned');

  // 5. A failing stage is reported honestly, not as success.
  fs.writeFileSync(
    path.join(toolTarget, 'test', 'index.test.js'),
    "import assert from 'node:assert/strict';\nassert.equal(1, 2, 'intentional failure');\n",
    'utf-8',
  );
  const failingStage = await toolExecutor.execute('RUN_PROJECT_STAGE', { project: toolName, stage: 'test' });
  // The tool itself ran; the STAGE failed. The stage outcome is reported in
  // output.success/exitCode, which is what the run flow keys off.
  assert.equal(failingStage.output.success, false, 'A failing test stage is reported as a failure');
  assert.notEqual(failingStage.output.exitCode, 0, 'A failing stage reports a non-zero exit code');

  // 6. Unknown projects and stages are refused.
  const missing = await toolExecutor.execute('RUN_PROJECT_STAGE', { project: 'does-not-exist', stage: 'test' });
  assert.equal(missing.success, false, 'An unknown project is refused');
  const badStage = await toolExecutor.execute('RUN_PROJECT_STAGE', { project: toolName, stage: 'deploy' });
  assert.equal(badStage.success, false, 'An unknown stage is refused');

  fs.rmSync(toolTarget, { recursive: true, force: true });
  console.log('  \u2713 real build/test stages run and report actual exit codes');
}
