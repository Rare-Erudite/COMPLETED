/**
 * RARE — Self-build run-state persistence
 *
 * A self-build that is interrupted (process restart on serverless, a deploy, a
 * timeout) left no trace: the next run started from nothing and could not tell
 * whether the workspace held its half-applied patches. That is worse than a
 * failure, because the caller had no way to know.
 *
 * This store records the run's checkpoint and the files it changed *before* and
 * *after* the mutation window, so an interrupted run can be resumed — and, when
 * it cannot be, can be restored to its checkpoint instead of being silently
 * abandoned.
 *
 * Records live under `.rare/runs/` (already git-ignored): they describe a
 * machine's local working state, not source.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface RunState {
  runId: string;
  instruction: string;
  checkpointId: string | null;
  appliedPaths: string[];
  status: 'running' | 'completed' | 'reverted' | 'blocked';
  startedAt: string;
  lastStep: number;
  updatedAt?: string;
}

export class RunStateStore {
  private readonly dir: string;

  constructor(root?: string) {
    this.dir = path.resolve(root || process.env.RARE_APP_ROOT || process.cwd(), '.rare', 'runs');
  }

  private file(runId: string): string {
    // Run ids are generated internally, but never trust a caller-provided path.
    const safe = runId.replace(/[^A-Za-z0-9_-]/g, '_');
    return path.join(this.dir, `${safe}.json`);
  }

  public save(state: Omit<RunState, 'updatedAt'> | RunState): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const record: RunState = { ...state, updatedAt: new Date().toISOString() };
      const target = this.file(state.runId);
      const temp = `${target}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(record, null, 2), 'utf-8');
      fs.renameSync(temp, target);
    } catch {
      // Persistence is a safety net, not the operation itself: never let a
      // failed write mask a build result.
    }
  }

  public load(runId: string): RunState | null {
    try {
      const target = this.file(runId);
      if (!fs.existsSync(target)) return null;
      const parsed = JSON.parse(fs.readFileSync(target, 'utf-8'));
      if (!parsed || typeof parsed !== 'object' || parsed.runId !== runId) return null;
      return parsed as RunState;
    } catch {
      return null;
    }
  }

  /**
   * Interrupted runs: `running` records that were never closed out. Newest
   * first, because that is the one a caller would want to resume.
   */
  public listInterrupted(): RunState[] {
    try {
      if (!fs.existsSync(this.dir)) return [];
      return fs
        .readdirSync(this.dir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => {
          try {
            return JSON.parse(fs.readFileSync(path.join(this.dir, name), 'utf-8')) as RunState;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is RunState => Boolean(entry) && entry!.status === 'running')
        .sort((a, b) => (b.updatedAt || b.startedAt).localeCompare(a.updatedAt || a.startedAt));
    } catch {
      return [];
    }
  }

  public clear(runId: string): void {
    try {
      fs.rmSync(this.file(runId), { force: true });
    } catch {
      // Nothing to do.
    }
  }
}
