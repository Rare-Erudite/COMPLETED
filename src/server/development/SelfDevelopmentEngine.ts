import path from 'path';
import { CheckpointStore } from '../storage/CheckpointStore.js';
import { TrajectoryStore } from '../storage/TrajectoryStore.js';
import { ToolExecutor } from '../tools/ToolExecutor.js';
import { DevelopmentTrajectory } from '../types.js';
import { PatchPlanner, type PlannedPatch } from './PatchPlanner.js';

import { resolveWritableAppRoot } from '../storage/PersistentJsonStore.js';
const PROJECT_ROOT = path.resolve(process.env.RARE_APP_ROOT || resolveWritableAppRoot());

export interface SelfDevRequest {
  instruction: string;
  targetFiles?: string[];
  maxRepairAttempts?: number;
  /**
   * Explicit patches supplied by a caller that already knows the change.
   * When absent, the engine plans them from the instruction via PatchPlanner.
   */
  patches?: PlannedPatch[];
}

export interface SelfDevResult {
  runId: string;
  status: 'VERIFIED_SUCCESS' | 'REVERTED_ON_FAILURE' | 'BLOCKED';
  trajectory: DevelopmentTrajectory;
  steps: Array<{ step: number; title: string; outcome: string; details?: string }>;
  /** Real diffs of what changed, empty when nothing was applied. */
  diffs?: Array<{ file: string; before: string; after: string }>;
  /** Why the run could not proceed, when status is BLOCKED. */
  blocker?: string;
  checkpointId: string;
  durationMs: number;
}

export class SelfDevelopmentEngine {
  constructor(
    private checkpointStore: CheckpointStore,
    private trajectoryStore: TrajectoryStore,
    private toolExecutor: ToolExecutor,
    /**
     * Workspace root the planner reads from. Defaults to the app root resolved
     * at construction time; injectable so a test can target a throwaway
     * workspace instead of the real repository.
     */
    private root: string = PROJECT_ROOT,
  ) {}

  public async executeCycle(
    req: SelfDevRequest,
    isDeveloperAuth: boolean
  ): Promise<SelfDevResult> {
    const startTime = Date.now();
    const runId = `sdev_${Date.now()}`;
    const steps: Array<{ step: number; title: string; outcome: string; details?: string }> = [];
    const maxRepairs = req.maxRepairAttempts ?? 3;
    let repairAttempts = 0;
    const changedFiles: string[] = [];
    const auditTrail: string[] = [];

    // Step 1: Inspect project and requirements
    steps.push({
      step: 1,
      title: 'Inspect Requirements',
      outcome: 'Completed',
      details: `Analyzed instruction: "${req.instruction}"`,
    });
    auditTrail.push(`Step 1: Analyzed instruction: ${req.instruction}`);

    // Step 2: Produce implementation plan
    const plan = `1. Safety checkpoint -> 2. Isolated patch -> 3. Build/Test verification -> 4. Error diagnosis (if needed) -> 5. Rollback or accept`;
    steps.push({
      step: 2,
      title: 'Produce Implementation Plan',
      outcome: 'Completed',
      details: plan,
    });
    auditTrail.push(`Step 2: Produced plan: ${plan}`);

    // Step 3: Create safety checkpoint
    const targetFiles = req.targetFiles || ['server.ts', 'src/App.tsx', 'rare.config.json'];
    const cp = this.checkpointStore.createCheckpoint(
      `Pre-change snapshot for: "${req.instruction.slice(0, 40)}"`,
      'experimental',
      targetFiles
    );
    steps.push({
      step: 3,
      title: 'Create Checkpoint Snapshot',
      outcome: 'Completed',
      details: `Checkpoint ${cp.id} created (${cp.filesCount} files secured, hash: ${cp.hash.slice(0, 16)}...)`,
    });
    auditTrail.push(`Step 3: Created checkpoint ${cp.id}`);

    // Step 4: Apply file modification (gated)
    // If not developer auth and targets core files, reject!
    if (!isDeveloperAuth) {
      steps.push({
        step: 4,
        title: 'Security Permission Check',
        outcome: 'Blocked',
        details: 'Self-development modifying RARE core source code requires Developer Passkey authorization.',
      });
      auditTrail.push('Step 4: Blocked: Developer authorization missing.');

      const trajectory: DevelopmentTrajectory = {
        id: `traj_${Date.now()}`,
        task: req.instruction,
        plan,
        actions: ['Permission denied at Step 4'],
        changedFiles: [],
        repairAttempts: 0,
        testOutcome: 'failed',
        status: 'REVERTED_ON_FAILURE',
        timestamp: new Date().toISOString(),
        auditTrail,
      };
      this.trajectoryStore.record(trajectory);

      return {
        runId,
        status: 'REVERTED_ON_FAILURE',
        trajectory,
        steps,
        checkpointId: cp.id,
        durationMs: Date.now() - startTime,
      };
    }

    // Step 4: Apply real patches.
    //
    // This step used to report "Completed" without touching a file, and
    // `changedFiles` stayed empty forever. A developer could ask RARE to change
    // its own source and get a green report describing a change that never
    // happened. Now the patches are planned against real source, applied through
    // the permission-controlled ToolExecutor, and the actual before/after text
    // is captured so the diff shown to the developer is the diff that landed.
    const planner = new PatchPlanner({ root: this.root });
    let patches: PlannedPatch[] = req.patches || [];
    let planBlocker: string | undefined;

    if (patches.length === 0) {
      const plan = await planner.plan(req.instruction);
      patches = plan.patches;
      planBlocker = plan.blocker;
    }

    if (patches.length === 0) {
      // Nothing to apply. Stop honestly rather than running a verification pass
      // over an unchanged tree and calling the result a success.
      const blocker =
        planBlocker ||
        'No grounded change could be derived from the instruction. Nothing was applied.';
      steps.push({
        step: 4,
        title: 'Modify Source Files',
        outcome: 'Blocked',
        details: blocker,
      });
      auditTrail.push(`Step 4: Blocked: ${blocker}`);

      const blockedTrajectory: DevelopmentTrajectory = {
        id: `traj_${Date.now()}`,
        task: req.instruction,
        plan,
        actions: steps.map((s) => `${s.step}. ${s.title}: ${s.outcome}`),
        changedFiles: [],
        repairAttempts: 0,
        testOutcome: 'not_run',
        status: 'REVERTED_ON_FAILURE',
        timestamp: new Date().toISOString(),
        auditTrail,
      };
      this.trajectoryStore.record(blockedTrajectory);

      return {
        runId,
        status: 'BLOCKED',
        trajectory: blockedTrajectory,
        steps,
        diffs: [],
        blocker,
        checkpointId: cp.id,
        durationMs: Date.now() - startTime,
      };
    }

    const diffs: Array<{ file: string; before: string; after: string }> = [];
    const applyFailures: string[] = [];

    for (const patch of patches) {
      const readRes = await this.toolExecutor.execute(
        'READ_FILE',
        { path: patch.file },
        { isDeveloperAuth: true },
      );
      const before: string | null =
        readRes.success && typeof readRes.output?.content === 'string'
          ? readRes.output.content
          : null;

      if (before === null) {
        applyFailures.push(`${patch.file}: could not be read before patching`);
        continue;
      }

      // The anchor must exist exactly once. A patch that would apply in two
      // places is ambiguous, and guessing is how a self-build corrupts a file.
      const first = before.indexOf(patch.search);
      if (first === -1) {
        applyFailures.push(`${patch.file}: the anchor text was not found`);
        continue;
      }
      if (before.indexOf(patch.search, first + 1) !== -1) {
        applyFailures.push(`${patch.file}: the anchor text appears more than once`);
        continue;
      }

      const after = before.slice(0, first) + patch.replace + before.slice(first + patch.search.length);

      const writeRes = await this.toolExecutor.execute(
        'WRITE_FILE',
        { path: patch.file, content: after },
        { isDeveloperAuth: true },
      );

      if (!writeRes.success) {
        applyFailures.push(`${patch.file}: write failed — ${writeRes.error || 'unknown error'}`);
        continue;
      }

      diffs.push({ file: patch.file, before, after });
      changedFiles.push(patch.file);
    }

    if (diffs.length === 0) {
      const blocker = `No patch could be applied. ${applyFailures.join('; ')}`;
      steps.push({
        step: 4,
        title: 'Modify Source Files',
        outcome: 'Blocked',
        details: blocker,
      });
      auditTrail.push(`Step 4: Blocked: ${blocker}`);

      const blockedTrajectory: DevelopmentTrajectory = {
        id: `traj_${Date.now()}`,
        task: req.instruction,
        plan,
        actions: steps.map((s) => `${s.step}. ${s.title}: ${s.outcome}`),
        changedFiles: [],
        repairAttempts: 0,
        testOutcome: 'not_run',
        status: 'REVERTED_ON_FAILURE',
        timestamp: new Date().toISOString(),
        auditTrail,
      };
      this.trajectoryStore.record(blockedTrajectory);

      return {
        runId,
        status: 'BLOCKED',
        trajectory: blockedTrajectory,
        steps,
        diffs: [],
        blocker,
        checkpointId: cp.id,
        durationMs: Date.now() - startTime,
      };
    }

    steps.push({
      step: 4,
      title: 'Modify Source Files',
      outcome: 'Completed',
      details:
        `Applied ${diffs.length} patch(es) to ${changedFiles.join(', ')}.` +
        (applyFailures.length ? ` Skipped: ${applyFailures.join('; ')}` : ''),
    });
    auditTrail.push(`Step 4: Applied ${diffs.length} patch(es): ${changedFiles.join(', ')}`);

    // Step 5: Run verification tests and builds
    steps.push({
      step: 5,
      title: 'Run Tests & Builds',
      outcome: 'Executing',
      details: 'Running TypeScript compile check and lint verification...',
    });

    const testRes = await this.toolExecutor.execute('RUN_TEST', {}, { isDeveloperAuth: true });
    let testPassed = testRes.success && testRes.output?.success;
    let failureDiagnosed: string | undefined;
    let repairApplied: string | undefined;

    // Step 6 & 7: Diagnose and repair if failed
    if (!testPassed && repairAttempts < maxRepairs) {
      repairAttempts++;
      const errOutput = testRes.output?.stderr || testRes.output?.stdout || testRes.error || 'Unknown test failure';
      const inspectRes = await this.toolExecutor.execute('INSPECT_ERROR', { errorText: errOutput });
      failureDiagnosed = inspectRes.output?.diagnosis || 'Diagnosed build regression';

      steps.push({
        step: 6,
        title: 'Inspect Error & Diagnose Root Cause',
        outcome: 'Completed',
        details: failureDiagnosed,
      });

      // A bounded repair attempt. Restoring the checkpoint is NOT a repair: it
      // undoes the change, which is a rollback. The distinction matters because
      // the old code reported "Apply Repair & Re-run Checks: Completed" after
      // only restoring, so a failed change looked like a fixed one.
      //
      // A real repair means: take the failure evidence, ask the planner for a
      // corrected patch against the current (already-modified) file, apply it,
      // and re-run the checks. If no grounded correction can be produced, say so
      // and roll back — do not claim a repair happened.
      const repairPlan = await planner.plan(
        `${req.instruction}\n\nThe previous attempt failed verification with:\n${String(errOutput).slice(0, 2000)}\nProduce a corrected change.`,
      );

      if (repairPlan.patches.length > 0) {
        const repaired: string[] = [];
        for (const patch of repairPlan.patches) {
          const readRes = await this.toolExecutor.execute(
            'READ_FILE',
            { path: patch.file },
            { isDeveloperAuth: true },
          );
          const current: string | null =
            readRes.success && typeof readRes.output?.content === 'string'
              ? readRes.output.content
              : null;
          if (current === null) continue;
          const at = current.indexOf(patch.search);
          if (at === -1 || current.indexOf(patch.search, at + 1) !== -1) continue;
          const next = current.slice(0, at) + patch.replace + current.slice(at + patch.search.length);
          const w = await this.toolExecutor.execute(
            'WRITE_FILE',
            { path: patch.file, content: next },
            { isDeveloperAuth: true },
          );
          if (w.success) repaired.push(patch.file);
        }

        if (repaired.length > 0) {
          repairApplied = `Applied a corrected patch to ${repaired.join(', ')} after diagnosing: ${failureDiagnosed}`;
          steps.push({
            step: 7,
            title: 'Apply Repair & Re-run Checks',
            outcome: 'Completed',
            details: repairApplied,
          });
          const reTest = await this.toolExecutor.execute('RUN_TEST', {}, { isDeveloperAuth: true });
          testPassed = reTest.success && reTest.output?.success;
        } else {
          repairApplied = undefined;
          steps.push({
            step: 7,
            title: 'Apply Repair & Re-run Checks',
            outcome: 'No repair applied',
            details:
              'A corrected patch was planned but none could be applied to the current file state. ' +
              'The change will be rolled back rather than reported as repaired.',
          });
        }
      } else {
        repairApplied = undefined;
        steps.push({
          step: 7,
          title: 'Apply Repair & Re-run Checks',
          outcome: 'No repair available',
          details:
            `No grounded correction could be derived (${repairPlan.blocker || 'no patch produced'}). ` +
            'The change will be rolled back rather than reported as repaired.',
        });
      }
    } else {
      steps.push({
        step: 6,
        title: 'Inspect Error Analysis',
        outcome: 'Clean (Zero Errors)',
        details: 'No regressions detected during compilation.',
      });
      steps.push({
        step: 7,
        title: 'Repair Step',
        outcome: 'Bypassed',
        details: 'Baseline compile verified cleanly; repair not needed.',
      });
    }

    // Step 8: Verify original acceptance criteria
    steps.push({
      step: 8,
      title: 'Verify Acceptance Criteria',
      outcome: testPassed ? 'Passed' : 'Failed',
      details: testPassed ? 'All syntax, type, and safety criteria met.' : 'Criteria failed.',
    });

    // Step 9: Show changed files and build results
    steps.push({
      step: 9,
      title: 'Build & Analysis Results',
      outcome: 'Completed',
      details: `Status: ${testPassed ? 'PASS' : 'FAIL'} • Changed files: ${changedFiles.length > 0 ? changedFiles.join(', ') : 'None (clean pass)'}`,
    });

    // Step 10: Accept or Rollback
    const finalStatus: 'VERIFIED_SUCCESS' | 'REVERTED_ON_FAILURE' = testPassed
      ? 'VERIFIED_SUCCESS'
      : 'REVERTED_ON_FAILURE';

    if (!testPassed) {
      this.checkpointStore.restoreCheckpoint(cp.id);
      steps.push({
        step: 10,
        title: 'Rollback & Revert to Checkpoint',
        outcome: 'Reverted',
        details: `Rolled back workspace to known-good checkpoint ${cp.id}`,
      });
      auditTrail.push(`Step 10: Rolled back to checkpoint ${cp.id}`);
    } else {
      steps.push({
        step: 10,
        title: 'Accept Changes',
        outcome: 'Accepted',
        details: `Changes accepted and validated. Checkpoint ${cp.id} preserved.`,
      });
      auditTrail.push(`Step 10: Accepted changes.`);
    }

    const trajectory: DevelopmentTrajectory = {
      id: `traj_${Date.now()}`,
      task: req.instruction,
      plan,
      actions: steps.map((s) => `${s.step}. ${s.title}: ${s.outcome}`),
      changedFiles,
      failureDiagnosed,
      repairApplied,
      repairAttempts,
      testOutcome: testPassed ? 'passed' : 'failed',
      status: finalStatus,
      timestamp: new Date().toISOString(),
      auditTrail,
    };

    this.trajectoryStore.record(trajectory);

    return {
      runId,
      status: finalStatus,
      trajectory,
      steps,
      diffs,
      checkpointId: cp.id,
      durationMs: Date.now() - startTime,
    };
  }
}
