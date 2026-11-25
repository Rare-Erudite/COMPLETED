/**
 * PatchPlanner — turns a natural-language self-build instruction into concrete,
 * grounded file patches.
 *
 * The defect this replaces: SelfDevelopmentEngine reported step 4 "Modify Source
 * Files: Completed" without ever touching a file, and `changedFiles` was
 * permanently empty. A developer could ask RARE to change its own source and
 * receive a green report describing a change that never happened.
 *
 * The rule here is that a patch must be anchored in text that was actually read
 * from the target file. If the planner cannot ground a change, it returns a
 * blocker with a reason — it never invents a `search` block, and it never
 * returns an empty patch list dressed up as success.
 */

import fs from 'fs';
import path from 'path';

export interface PlannedPatch {
  /** Workspace-relative path. */
  file: string;
  /** Exact existing text to replace. Must appear exactly once. */
  search: string;
  /** Replacement text. */
  replace: string;
  /** Why this patch is believed to satisfy the instruction. */
  rationale: string;
}

export interface PatchPlan {
  patches: PlannedPatch[];
  /** Non-empty when the planner could not produce a grounded change. */
  blocker?: string;
  /** Files the planner actually read while grounding. */
  inspected: string[];
}

export interface PatchPlannerOptions {
  /** Workspace root the planner may read from. */
  root: string;
  /** Optional model-backed planner. When absent, only deterministic rules run. */
  modelPlanner?: (instruction: string, context: string) => Promise<PlannedPatch[]>;
  /** Maximum files to read while grounding. */
  maxFiles?: number;
}

/** Paths a self-build may edit. Anything else is refused, not silently skipped. */
const EDITABLE_PREFIXES = ['src/', 'server.ts', 'api/', 'scripts/', 'tests/', 'docs/'];

/** Never editable through this path, even by a developer. */
const FORBIDDEN = ['.git/', 'node_modules/', '.env', 'dist/', 'server-build/', 'public/'];

export class PatchPlanner {
  constructor(private options: PatchPlannerOptions) {}

  private isEditable(rel: string): boolean {
    const norm = rel.replace(/\\/g, '/');
    if (FORBIDDEN.some((f) => norm === f.replace(/\/$/, '') || norm.startsWith(f))) return false;
    return EDITABLE_PREFIXES.some((p) => norm === p || norm.startsWith(p));
  }

  /**
   * Extract file paths the instruction names explicitly. A developer who says
   * "fix src/server/tools/ToolExecutor.ts" has told us exactly where to look;
   * guessing elsewhere would be worse than asking.
   */
  private namedFiles(instruction: string): string[] {
    const matches = instruction.match(/[\w./-]+\.(?:ts|tsx|js|mjs|json|md|css|html)/g) || [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of matches) {
      const rel = m.replace(/^\.\//, '');
      if (seen.has(rel)) continue;
      seen.add(rel);
      out.push(rel);
    }
    return out;
  }

  /** Read a file, returning null when it is missing or not editable. */
  private read(rel: string): string | null {
    if (!this.isEditable(rel)) return null;
    const full = path.resolve(this.options.root, rel);
    if (!full.startsWith(path.resolve(this.options.root))) return null;
    try {
      if (!fs.statSync(full).isFile()) return null;
      return fs.readFileSync(full, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Deterministic rules for instructions that name a file and a concrete edit.
   * These are the cases where a change can be grounded without a model.
   */
  private deterministicPatches(instruction: string, files: string[]): PlannedPatch[] {
    const patches: PlannedPatch[] = [];

    // "add a comment <text> to <file>" / "add a comment to <file>"
    const commentMatch = instruction.match(
      /add\s+(?:a\s+)?comment(?:\s+(?:saying|that says|with text)?\s*["']?([^"']+?)["']?)?\s+(?:to|in|at the top of)\s+([\w./-]+\.(?:ts|tsx|js|mjs))/i,
    );
    if (commentMatch) {
      const [, text, file] = commentMatch;
      const content = this.read(file);
      if (content !== null) {
        const body = (text || 'RARE self-build marker').trim();
        const marker = `// ${body}\n`;
        if (!content.startsWith(marker)) {
          patches.push({
            file,
            search: content.slice(0, 1),
            replace: marker + content.slice(0, 1),
            rationale: `Prepend the requested comment to ${file}.`,
          });
        }
      }
    }

    // "rename <old> to <new>" inside a named file — a real, verifiable edit.
    const renameMatch = instruction.match(
      /rename\s+["'`]?([\w$]+)["'`]?\s+to\s+["'`]?([\w$]+)["'`]?/i,
    );
    if (renameMatch && files.length > 0) {
      const [, from, to] = renameMatch;
      for (const file of files) {
        const content = this.read(file);
        if (content === null) continue;
        const occurrences = content.split(new RegExp(`\\b${from}\\b`, 'g')).length - 1;
        if (occurrences === 1) {
          patches.push({
            file,
            search: from,
            replace: to,
            rationale: `Rename the single occurrence of "${from}" to "${to}" in ${file}.`,
          });
          break;
        }
      }
    }

    return patches;
  }

  public async plan(instruction: string): Promise<PatchPlan> {
    const inspected: string[] = [];
    const named = this.namedFiles(instruction);

    // Ground against the files the instruction names. A named file that does
    // not exist is a blocker, not something to work around.
    const missing: string[] = [];
    for (const rel of named) {
      const content = this.read(rel);
      if (content === null) {
        missing.push(rel);
      } else {
        inspected.push(rel);
      }
    }

    if (named.length > 0 && inspected.length === 0) {
      return {
        patches: [],
        inspected,
        blocker:
          `None of the files named in the instruction could be read: ${missing.join(', ')}. ` +
          `They are either missing or outside the editable roots (${EDITABLE_PREFIXES.join(', ')}).`,
      };
    }

    const deterministic = this.deterministicPatches(instruction, inspected);
    if (deterministic.length > 0) {
      return { patches: deterministic, inspected };
    }

    // A model-backed planner can handle open-ended instructions, but only when
    // it is given real source to anchor on.
    if (this.options.modelPlanner && inspected.length > 0) {
      const context = inspected
        .map((rel) => `--- ${rel} ---\n${(this.read(rel) || '').slice(0, 6000)}`)
        .join('\n\n');
      try {
        const planned = await this.options.modelPlanner(instruction, context);
        const valid = planned.filter((p) => {
          if (!this.isEditable(p.file)) return false;
          const content = this.read(p.file);
          if (content === null) return false;
          // The anchor must exist exactly once, or the patch is not applicable.
          const first = content.indexOf(p.search);
          if (first === -1) return false;
          return content.indexOf(p.search, first + 1) === -1;
        });
        if (valid.length > 0) return { patches: valid, inspected };
        return {
          patches: [],
          inspected,
          blocker:
            'The planner produced no patch whose anchor exists exactly once in the target file. ' +
            'Nothing was applied.',
        };
      } catch (error: any) {
        return {
          patches: [],
          inspected,
          blocker: `The patch planner failed: ${error?.message || String(error)}. Nothing was applied.`,
        };
      }
    }

    return {
      patches: [],
      inspected,
      blocker:
        named.length === 0
          ? 'The instruction does not name a file to change, and no model-backed planner is configured. ' +
            'Name the file (for example "in src/server/tools/ToolExecutor.ts ...") so the change can be grounded.'
          : 'No grounded change could be derived from the instruction for the named file(s). Nothing was applied.',
    };
  }
}
