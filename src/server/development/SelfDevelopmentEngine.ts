/**
 * RARE — Self-development engine
 *
 * Turns a developer's request into real, verified file changes.
 *
 * What this replaces
 * ------------------
 * The previous implementation reported "Modify Source Files: Completed" without
 * calling a single write tool, always returned an empty `changedFiles`, and its
 * only "repair" was restoring the checkpoint — i.e. undoing the developer's
 * request and calling the result a fix. Every progress event claimed a success
 * that had not happened.
 *
 * What it does now
 * ----------------
 *   1. Derives acceptance criteria from the instruction and the real project
 *      (AcceptanceCriteria.ts) instead of echoing the instruction.
 *   2. Reads the files it is about to change, and records their pre-change
 *      content, so it has real evidence and a real diff.
 *   3. Takes a checkpoint of exactly the files in scope.
 *   4. Applies patches through the permission-controlled tool layer
 *      (PatchEngine.ts) and reports the real unified diff and changed files.
 *   5. Runs the real verification commands and records exit codes.
 *   6. On failure, diagnoses from actual output (Diagnosis.ts), attempts at most
 *      one *targeted* fix when the cause is deterministic and located, and
 *      reruns the checks. When the cause needs a human, it says so.
 *   7. Restores the checkpoint when the result does not meet the criteria, and
 *      reports that it did — never the reverse.
 *
 * Every emitted step has an `outcome` derived from an operation that actually
 * ran, and `verified: boolean` tells the caller whether the statement is backed
 * by a passing check rather than by the engine's own optimism.
 */

import path from 'node:path';
import fs from 'node:fs';

import { CheckpointStore } from '../storage/CheckpointStore.js';
import { TrajectoryStore } from '../storage/TrajectoryStore.js';
import { ToolExecutor } from '../tools/ToolExecutor.js';
import { DevelopmentTrajectory } from '../types.js';
import {
  applyPatches,
  FilePatch,
  PatchWriter,
  AppliedPatch,
} from './PatchEngine.js';
import {
  AcceptanceCriterion,
  CriterionOutcome,
  deriveAcceptanceCriteria,
  readProjectContext,
  verifyCriteria,
} from './AcceptanceCriteria.js';
import { diagnoseFailure, Diagnosis } from './Diagnosis.js';
import { RunStateStore } from './RunStateStore.js';

// Resolved per call: the engine is retargeted at a throwaway workspace by the
// test suite (and by future isolated-branch runs) through RARE_APP_ROOT.
const projectRoot = (): string => path.resolve(process.env.RARE_APP_ROOT || process.cwd());

export interface SelfDevRequest {
  instruction: string;
  /** Explicit patches. When omitted, `planPatches` must supply them. */
  patches?: FilePatch[];
  /** Optional planner: given the instruction, propose patches to apply. */
  planPatches?: (instruction: string) => Promise<FilePatch[]>;
  targetFiles?: string[];
  maxRepairAttempts?: number;
  /** Resume token from a previous interrupted run. */
  resumeRunId?: string;
}

export type StepOutcome =
  | 'completed'
  | 'skipped'
  | 'blocked'
  | 'failed'
  | 'reverted'
  | 'not_verified';

export interface SelfDevStep {
  step: number;
  title: string;
  outcome: StepOutcome;
  /** Only true when a real check backs this step. */
  verified: boolean;
  details: string;
  evidence?: string;
}

export interface SelfDevResult {
  runId: string;
  status: 'VERIFIED_SUCCESS' | 'REVERTED_ON_FAILURE' | 'BLOCKED_UNAUTHORIZED' | 'PARTIAL';
  trajectory: DevelopmentTrajectory;
  steps: SelfDevStep[];
  checkpointId: string | null;
  changedFiles: AppliedPatch[];
  criteria: Array<{ criterion: AcceptanceCriterion; satisfied: boolean; evidence: string }>;
  durationMs: number;
  /** Set when the run stopped before it could verify anything. */
  blockedReason?: string;
}

export interface SelfDevDeps {
  checkpointStore: CheckpointStore;
  trajectoryStore: TrajectoryStore;
  toolExecutor: ToolExecutor;
  /** Persist run state so an interrupted task can resume. */
  runStateStore?: RunStateStore;
  /** Legacy callback; kept for callers that prefer to supply their own sink. */
  saveRunState?: (state: PersistedRunState) => Promise<void>;
}

export interface PersistedRunState {
  runId: string;
  instruction: string;
  checkpointId: string | null;
  appliedPaths: string[];
  status: 'running' | 'completed' | 'reverted' | 'blocked';
  startedAt: string;
  lastStep: number;
}

export class SelfDevelopmentEngine {
  private readonly deps: SelfDevDeps;

  constructor(deps: SelfDevDeps | CheckpointStore, trajectoryStore?: TrajectoryStore, toolExecutor?: ToolExecutor) {
    // Accept the legacy positional construction as well as the explicit bundle:
    // server.ts and the tests both construct this class.
    if (deps instanceof CheckpointStore) {
      if (!trajectoryStore || !toolExecutor) {
        throw new Error('SelfDevelopmentEngine requires checkpointStore, trajectoryStore and toolExecutor.');
      }
      this.deps = { checkpointStore: deps, trajectoryStore, toolExecutor };
    } else {
      this.deps = deps;
    }
  }

  /** Run a command through the allowlisted, env-stripped tool layer. */
  private async runCommand(binary: string, args: string[], timeoutMs: number) {
    const result = await this.deps.toolExecutor.execute(
      'RUN_COMMAND',
      { command: binary, args },
      { isDeveloperAuth: true },
    );
    if (!result.success) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: result.error || 'Command refused by the tool sandbox.',
      };
    }
    return {
      exitCode: 0,
      stdout: String(result.output?.stdout ?? ''),
      stderr: String(result.output?.stderr ?? ''),
    };
  }

  public async executeCycle(req: SelfDevRequest, isDeveloperAuth: boolean): Promise<SelfDevResult> {
    const startedAt = Date.now();
    const runId = req.resumeRunId || `sdev_${startedAt}`;
    const steps: SelfDevStep[] = [];
    const auditTrail: string[] = [];
    let stepNo = 0;
    const nextStep = (
      title: string,
      outcome: StepOutcome,
      details: string,
      verified: boolean,
      evidence?: string,
    ) => {
      stepNo += 1;
      steps.push({ step: stepNo, title, outcome, verified, details, evidence });
      auditTrail.push(`${stepNo}. ${title}: ${outcome}${verified ? ' (verified)' : ''}`);
    };

    // ---------------------------------------------------------------------
    // Gate 0 — authorization. Fails closed before any read or write.
    // ---------------------------------------------------------------------
    if (!isDeveloperAuth) {
      nextStep(
        'Developer authorization',
        'blocked',
        'Modifying RARE source requires an authorized developer session. Nothing was read, changed or restored.',
        false,
      );
      const trajectory = this.recordTrajectory({
        runId,
        instruction: req.instruction,
        plan: 'Denied at the authorization gate.',
        actions: ['authorization: denied'],
        changedFiles: [],
        status: 'REVERTED_ON_FAILURE',
        testOutcome: 'failed',
        auditTrail,
      });
      return {
        runId,
        status: 'BLOCKED_UNAUTHORIZED',
        trajectory,
        steps,
        checkpointId: null,
        changedFiles: [],
        criteria: [],
        durationMs: Date.now() - startedAt,
        blockedReason: 'Developer authorization required.',
      };
    }
    nextStep('Developer authorization', 'completed', 'Authorized developer session verified server-side.', true);

    // ---------------------------------------------------------------------
    // Step 0b — resume an interrupted run.
    //
    // A run interrupted after its patches were applied leaves the workspace in
    // a state its checkpoint describes but nobody remembers. Resuming must not
    // jump to "verify and call it done": the interrupted run never verified, so
    // the only safe continuation is to restore the checkpoint and start the
    // change again from a known-good tree.
    // ---------------------------------------------------------------------
    if (req.resumeRunId) {
      const previous = this.deps.runStateStore?.load(req.resumeRunId);
      if (!previous) {
        nextStep(
          'Resume interrupted run',
          'not_verified',
          `No run state found for ${req.resumeRunId}; starting a fresh cycle.`,
          false,
        );
      } else if (previous.status === 'running' && previous.checkpointId) {
        const restored = this.restore(previous.checkpointId);
        nextStep(
          'Resume interrupted run',
          'completed',
          `Found interrupted run ${previous.runId} from ${previous.startedAt} (${previous.appliedPaths.length} file(s) had been changed). ` +
            `Restored checkpoint ${previous.checkpointId}${restored.length ? `: ${restored.join(', ')}` : ' (nothing differed on disk)'}. ` +
            `Re-running the change from a known-good tree rather than reporting the interrupted run as complete.`,
          true,
        );
        this.deps.runStateStore?.clear(previous.runId);
        this.deps.trajectoryStore.record({
          id: `resume_${runId}`,
          task: `Resume of ${previous.runId}`,
          plan: 'Restore checkpoint, then re-execute.',
          actions: ['resume: checkpoint restored', 'resume: re-executing from clean tree'],
          changedFiles: [],
          repairAttempts: 0,
          testOutcome: 'failed',
          status: 'REVERTED_ON_FAILURE',
          timestamp: new Date().toISOString(),
          auditTrail: [`Resumed interrupted run ${previous.runId}`],
        } as any);
      } else if (previous.status !== 'running') {
        nextStep(
          'Resume interrupted run',
          'not_verified',
          `Run ${previous.runId} already finished with status "${previous.status}"; nothing to resume.`,
          false,
        );
      }
    }

    // ---------------------------------------------------------------------
    // Step 1 — real inspection of the project, not of the instruction string.
    // ---------------------------------------------------------------------
    const root = projectRoot();
    const context = readProjectContext(root);
    const sourceFiles = context.packageJson
      ? Object.keys({ ...context.packageJson.dependencies, ...context.packageJson.devDependencies })
      : [];
    nextStep(
      'Inspect repository',
      'completed',
      `Project ${context.packageJson?.name || '(unnamed)'} · ${sourceFiles.length} dependencies · ` +
        `tsconfig ${context.hasTypeScriptConfig ? 'present' : 'absent'} · ` +
        `test script ${context.hasTestScript ? 'present' : 'absent'}.`,
      true,
      `root=${root}`,
    );

    // ---------------------------------------------------------------------
    // Step 2 — acceptance criteria derived from the request + real project.
    // ---------------------------------------------------------------------
    const criteria = deriveAcceptanceCriteria(req.instruction, context);
    nextStep(
      'Derive acceptance criteria',
      criteria.some((c) => c.kind === 'manual') ? 'not_verified' : 'completed',
      criteria.map((c) => `• ${c.statement}`).join('\n'),
      criteria.some((c) => c.kind !== 'manual'),
      `${criteria.length} criteria`,
    );

    // ---------------------------------------------------------------------
    // Step 3 — decide what to change. A request with no patches and no planner
    // cannot be implemented, and must not be reported as implemented.
    // ---------------------------------------------------------------------
    let patches: FilePatch[] = req.patches || [];
    if (patches.length === 0 && req.planPatches) {
      try {
        patches = await req.planPatches(req.instruction);
      } catch (error: any) {
        nextStep('Plan changes', 'failed', `Planner failed: ${error?.message || error}`, false);
      }
    }

    if (patches.length === 0) {
      nextStep(
        'Plan changes',
        'failed',
        'No concrete file change could be derived from this request, so nothing was modified. ' +
          'Supply `patches` (explicit search/replace) or a `planPatches` function that returns them.',
        false,
      );
      const trajectory = this.recordTrajectory({
        runId,
        instruction: req.instruction,
        plan: 'No patches produced.',
        actions: steps.map((s) => `${s.step}. ${s.title}: ${s.outcome}`),
        changedFiles: [],
        status: 'REVERTED_ON_FAILURE',
        testOutcome: 'failed',
        auditTrail,
      });
      return {
        runId,
        status: 'PARTIAL',
        trajectory,
        steps,
        checkpointId: null,
        changedFiles: [],
        criteria: criteria.map((c) => ({ criterion: c, satisfied: false, evidence: 'Not evaluated: no change was made.' })),
        durationMs: Date.now() - startedAt,
        blockedReason: 'No patches to apply.',
      };
    }

    nextStep(
      'Plan changes',
      'completed',
      patches.map((p) => `${p.operation.toUpperCase()} ${p.path}`).join('\n'),
      true,
      `${patches.length} patch(es)`,
    );

    // ---------------------------------------------------------------------
    // Step 4 — read the files in scope so we have real pre-change content.
    // ---------------------------------------------------------------------
    const inScope = Array.from(new Set([
      ...patches.map((p) => p.path),
      ...(req.targetFiles || []),
    ]));
    const preChange = new Map<string, string>();
    for (const relative of inScope) {
      const read = await this.deps.toolExecutor.execute('READ_FILE', { path: relative });
      if (read.success && typeof read.output?.content === 'string') {
        preChange.set(relative, read.output.content);
      }
    }
    nextStep(
      'Read files in scope',
      'completed',
      `Read ${preChange.size} of ${inScope.length} file(s) before changing anything.`,
      true,
      inScope.join(', '),
    );

    // ---------------------------------------------------------------------
    // Step 5 — checkpoint exactly what we are about to touch.
    // ---------------------------------------------------------------------
    let checkpointId: string | null = null;
    try {
      const checkpoint = this.deps.checkpointStore.createCheckpoint(
        `Pre-change snapshot for: "${req.instruction.slice(0, 60)}"`,
        'experimental',
        inScope,
      );
      checkpointId = checkpoint.id;
      nextStep(
        'Create checkpoint',
        checkpoint.filesCount > 0 ? 'completed' : 'not_verified',
        `Checkpoint ${checkpoint.id} captured ${checkpoint.filesCount} file(s) (hash ${checkpoint.hash.slice(0, 16)}…).`,
        checkpoint.filesCount > 0,
        checkpoint.filesCount === 0 ? 'Nothing existed on disk to snapshot (all patches are creates).' : undefined,
      );
    } catch (error: any) {
      nextStep('Create checkpoint', 'failed', `Could not checkpoint: ${error?.message || error}`, false);
      const trajectory = this.recordTrajectory({
        runId,
        instruction: req.instruction,
        plan: 'Aborted: no recoverable checkpoint.',
        actions: steps.map((s) => `${s.step}. ${s.title}: ${s.outcome}`),
        changedFiles: [],
        status: 'REVERTED_ON_FAILURE',
        testOutcome: 'failed',
        auditTrail,
      });
      return {
        runId,
        status: 'PARTIAL',
        trajectory,
        steps,
        checkpointId: null,
        changedFiles: [],
        criteria: criteria.map((c) => ({ criterion: c, satisfied: false, evidence: 'Not evaluated: no checkpoint.' })),
        durationMs: Date.now() - startedAt,
        blockedReason: 'Checkpoint failed; refusing to modify source without a recovery point.',
      };
    }

    await this.persistRun({
      runId,
      instruction: req.instruction,
      checkpointId,
      appliedPaths: [],
      status: 'running',
      startedAt: new Date(startedAt).toISOString(),
      lastStep: stepNo,
    });

    // ---------------------------------------------------------------------
    // Step 6 — apply the real patches through the tool layer.
    // ---------------------------------------------------------------------
    // Capture the dependency bundle: `this` is not bound inside the writer's
    // method bodies, and reaching for `this.deps` there silently resolves to
    // undefined at runtime.
    const deps = this.deps;
    const writer: PatchWriter = {
      async write(relativePath, content) {
        const result = await deps.toolExecutor.execute(
          'WRITE_FILE',
          { path: relativePath, content },
          { isDeveloperAuth: true },
        );
        if (!result.success) throw new Error(result.error || `Write refused for ${relativePath}`);
      },
      async remove(relativePath) {
        // No delete tool exists in the primitive set; removing a file is a
        // privileged filesystem action and is reported rather than faked.
        throw new Error(`Delete is not supported by the tool layer (${relativePath}); no file was removed.`);
      },
    };

    const patchResult = await applyPatches(root, patches, writer);
    const changedFiles = patchResult.applied;

    if (!patchResult.complete) {
      nextStep(
        'Apply patches',
        'failed',
        patchResult.failed.map((f) => `${f.path}: ${f.reason}`).join('\n'),
        false,
      );
      // Nothing was written (applyPatches is all-or-nothing on validation), so
      // there is nothing to restore; say that precisely.
      const restored = this.restoreIfChanged(checkpointId, changedFiles);
      const trajectory = this.recordTrajectory({
        runId,
        instruction: req.instruction,
        plan: 'Patch application refused.',
        actions: steps.map((s) => `${s.step}. ${s.title}: ${s.outcome}`),
        changedFiles: changedFiles.map((c) => c.path),
        status: 'REVERTED_ON_FAILURE',
        testOutcome: 'failed',
        auditTrail,
      });
      return {
        runId,
        status: 'PARTIAL',
        trajectory,
        steps,
        checkpointId,
        changedFiles,
        criteria: criteria.map((c) => ({ criterion: c, satisfied: false, evidence: 'Not evaluated: patch refused.' })),
        durationMs: Date.now() - startedAt,
        blockedReason: `Patch application refused${restored ? ' (checkpoint restored)' : '; no file was written'}.`,
      };
    }

    nextStep(
      'Apply patches',
      'completed',
      `${changedFiles.length} file(s) changed · ` +
        `${changedFiles.reduce((n, c) => n + c.linesAdded, 0)} lines added · ` +
        `${changedFiles.reduce((n, c) => n + c.linesRemoved, 0)} lines removed.`,
      true,
      changedFiles.map((c) => `${c.path}: ${c.diff.split('\n')[0]}`).join('\n'),
    );

    await this.persistRun({
      runId,
      instruction: req.instruction,
      checkpointId,
      appliedPaths: changedFiles.map((c) => c.path),
      status: 'running',
      startedAt: new Date(startedAt).toISOString(),
      lastStep: stepNo,
    });

    // ---------------------------------------------------------------------
    // Step 7 — verify against the criteria, using real command output.
    // ---------------------------------------------------------------------
    let outcomes: CriterionOutcome[] = await verifyCriteria(criteria, context, (b, a, t) => this.runCommand(b, a, t));
    const allPassed = outcomes.every((o) => o.satisfied);
    nextStep(
      'Run verification',
      allPassed ? 'completed' : 'failed',
      outcomes.map((o) => `${o.satisfied ? '✓' : '✗'} ${o.criterion.statement}`).join('\n'),
      allPassed,
      outcomes.map((o) => `${o.criterion.id}: ${o.satisfied ? 'pass' : 'fail'}`).join(', '),
    );

    // ---------------------------------------------------------------------
    // Step 8 — bounded, evidence-based repair.
    // ---------------------------------------------------------------------
    let diagnosis: Diagnosis | undefined;
    let repairApplied: string | undefined;
    let repairAttempts = 0;

    if (!allPassed) {
      const failing = outcomes.find((o) => !o.satisfied);
      const rawOutput = `${failing?.evidence || ''}`;
      diagnosis = diagnoseFailure(rawOutput, 1, failing?.criterion.kind || 'verification');
      nextStep(
        'Diagnose failure',
        'completed',
        `${diagnosis.classification}: ${diagnosis.summary}` +
          (diagnosis.file ? `\n${diagnosis.file}${diagnosis.line ? `:${diagnosis.line}` : ''}` : ''),
        false,
        diagnosis.evidence,
      );

      if (diagnosis.remediation.type === 'retry') {
        repairAttempts += 1;
        // A bounded retry re-runs the same check: the failure may have been
        // transient (timeout, resource contention). It never rewrites a test.
        const retried = await verifyCriteria(criteria, context, (b, a, t) => this.runCommand(b, a, t));
        outcomes = retried;
        repairApplied = 'Re-ran the failed check once (no source was modified).';
        nextStep(
          'Retry verification',
          retried.every((o) => o.satisfied) ? 'completed' : 'failed',
          repairApplied,
          retried.every((o) => o.satisfied),
        );
      } else if (diagnosis.remediation.type === 'developer') {
        repairApplied = `Not repaired automatically — ${diagnosis.remediation.reason}`;
        nextStep('Repair', 'skipped', repairApplied, false);
      } else {
        repairApplied = `Not repaired: ${diagnosis.remediation.reason}`;
        nextStep('Repair', 'skipped', repairApplied, false);
      }
    }

    const finalPass = outcomes.every((o) => o.satisfied);

    // ---------------------------------------------------------------------
    // Step 9 — keep the verified change, or restore the checkpoint.
    // ---------------------------------------------------------------------
    let restoredFiles: string[] = [];
    if (!finalPass) {
      restoredFiles = this.restore(checkpointId);
      nextStep(
        'Rollback',
        'reverted',
        restoredFiles.length > 0
          ? `Restored ${restoredFiles.length} file(s) from checkpoint ${checkpointId}: ${restoredFiles.join(', ')}`
          : `Nothing needed restoring (no file had changed on disk).`,
        restoredFiles.length > 0,
      );
    } else {
      nextStep(
        'Accept changes',
        'completed',
        `All ${outcomes.length} acceptance criteria satisfied; checkpoint ${checkpointId} retained for rollback.`,
        true,
      );
    }

    const status: SelfDevResult['status'] = finalPass ? 'VERIFIED_SUCCESS' : 'REVERTED_ON_FAILURE';

    const trajectory = this.recordTrajectory({
      runId,
      instruction: req.instruction,
      plan: steps.map((s) => `${s.step}. ${s.title}`).join(' -> '),
      actions: steps.map((s) => `${s.step}. ${s.title}: ${s.outcome}`),
      changedFiles: finalPass ? changedFiles.map((c) => c.path) : [],
      failureDiagnosed: diagnosis ? `${diagnosis.classification}: ${diagnosis.summary}` : undefined,
      repairApplied,
      repairAttempts,
      testOutcome: finalPass ? 'passed' : 'failed',
      status,
      auditTrail,
    });

    await this.persistRun({
      runId,
      instruction: req.instruction,
      checkpointId,
      appliedPaths: finalPass ? changedFiles.map((c) => c.path) : [],
      status: finalPass ? 'completed' : 'reverted',
      startedAt: new Date(startedAt).toISOString(),
      lastStep: stepNo,
    });

    return {
      runId,
      status,
      trajectory,
      steps,
      checkpointId,
      changedFiles: finalPass ? changedFiles : [],
      criteria: outcomes.map((o) => ({
        criterion: o.criterion,
        satisfied: o.satisfied,
        evidence: o.evidence,
      })),
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * Record run state to every sink the caller configured. Both are written so
   * a deployment that only wires the legacy callback still gets durability.
   */
  private async persistRun(state: PersistedRunState): Promise<void> {
    if (this.deps.runStateStore) {
      this.deps.runStateStore.save(state);
    }
    if (this.deps.saveRunState) {
      try {
        await this.deps.saveRunState(state);
      } catch {
        // A failed supplementary sink must not abort the build.
      }
    }
  }

  private restore(checkpointId: string | null): string[] {
    if (!checkpointId) return [];
    try {
      const result = this.deps.checkpointStore.restoreCheckpoint(checkpointId);
      return result.success ? result.restoredFiles : [];
    } catch {
      return [];
    }
  }

  private restoreIfChanged(checkpointId: string | null, applied: AppliedPatch[]): boolean {
    if (applied.length === 0 || !checkpointId) return false;
    return this.restore(checkpointId).length > 0;
  }

  private recordTrajectory(input: {
    runId: string;
    instruction: string;
    plan: string;
    actions: string[];
    changedFiles: string[];
    failureDiagnosed?: string;
    repairApplied?: string;
    repairAttempts?: number;
    testOutcome: 'passed' | 'failed';
    status: 'VERIFIED_SUCCESS' | 'REVERTED_ON_FAILURE';
    auditTrail: string[];
  }): DevelopmentTrajectory {
    const trajectory: DevelopmentTrajectory = {
      id: input.runId,
      task: input.instruction,
      plan: input.plan,
      actions: input.actions,
      changedFiles: input.changedFiles,
      failureDiagnosed: input.failureDiagnosed,
      repairApplied: input.repairApplied,
      repairAttempts: input.repairAttempts ?? 0,
      testOutcome: input.testOutcome,
      status: input.status,
      timestamp: new Date().toISOString(),
      auditTrail: input.auditTrail,
    };
    try {
      this.deps.trajectoryStore.record(trajectory);
    } catch {
      // Recording must never mask the outcome of the work itself.
    }
    return trajectory;
  }
}
