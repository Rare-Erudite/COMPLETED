/**
 * RARE — Acceptance criteria
 *
 * A self-build request arrives as free text. Before this module the engine only
 * echoed the instruction back ("Analyzed instruction: ...") and then declared
 * success, so "done" meant "the string was stored". Criteria are now derived
 * from the instruction and from the real state of the repository, and each one
 * is later checked against real command output.
 *
 * Criteria are deliberately conservative: when an instruction cannot be mapped
 * to something checkable, we say so (`kind: 'manual'`) instead of inventing a
 * passing assertion.
 */

import fs from 'node:fs';
import path from 'node:path';

export type CriterionKind =
  | 'build'        // the project must compile/bundle
  | 'typecheck'    // TypeScript must report no errors
  | 'tests'        // the test suite must pass
  | 'lint'         // configured linter must pass
  | 'file_exists'  // a named file must exist afterwards
  | 'content'      // a named file must contain a given substring
  | 'manual';      // cannot be verified automatically

export interface AcceptanceCriterion {
  id: string;
  /** Human-readable statement of what must be true. */
  statement: string;
  kind: CriterionKind;
  /** File the criterion is about, when applicable. */
  path?: string;
  /** Expected substring for `content` criteria. */
  expectation?: string;
  /** Command that verifies it, when applicable. */
  command?: { binary: string; args: string[] };
  /** Populated after verification. */
  satisfied?: boolean;
  /** Real evidence (exit code + trimmed output). */
  evidence?: string;
}

export interface CriterionProjectContext {
  root: string;
  /** Parsed package.json, when present. */
  packageJson?: {
    name?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  hasTypeScriptConfig: boolean;
  /** True when the project ships a test runner the engine can invoke. */
  hasTestScript: boolean;
}

export function readProjectContext(root: string): CriterionProjectContext {
  let packageJson: CriterionProjectContext['packageJson'];
  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    } catch {
      packageJson = undefined;
    }
  }

  return {
    root,
    packageJson,
    hasTypeScriptConfig: fs.existsSync(path.join(root, 'tsconfig.json')),
    hasTestScript: Boolean(packageJson?.scripts?.test),
  };
}

/** Pull workspace-relative file paths mentioned in an instruction. */
function mentionedPaths(instruction: string): string[] {
  const matches = instruction.match(
    /(?:^|[\s"'(])([A-Za-z0-9_.@/-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|scss|md|yml|yaml|sql|py|go|rs|java|kt|dart))(?=$|[\s"'),:;])/g,
  );
  if (!matches) return [];
  return Array.from(new Set(matches.map((m) => m.trim().replace(/^[\s"'(]+/, ''))));
}

/**
 * Derive criteria for `instruction`.
 *
 * The shape of the instruction decides what is verifiable:
 *   - any change to a TypeScript/JavaScript project must still typecheck/build
 *   - a named file must exist (create) or contain the stated text (modify)
 *   - an explicit "test"/"fix failing test" request requires the suite to pass
 */
export function deriveAcceptanceCriteria(
  instruction: string,
  context: CriterionProjectContext,
): AcceptanceCriterion[] {
  const criteria: AcceptanceCriterion[] = [];
  const lower = instruction.toLowerCase();
  const paths = mentionedPaths(instruction);
  const isWebProject = Boolean(
    context.packageJson?.devDependencies?.vite || context.packageJson?.dependencies?.vite,
  );

  // 1. The instruction names files → they must be the ones that change.
  for (const filePath of paths) {
    criteria.push({
      id: `file_${filePath.replace(/[^a-z0-9]+/gi, '_')}`,
      statement: `${filePath} exists after the change`,
      kind: 'file_exists',
      path: filePath,
    });
  }

  // 2. Quoted expectations ("... should contain X") are checkable.
  const quoted = instruction.match(/["'`]([^"'`]{3,120})["'`]/);
  if (quoted && paths.length === 1) {
    criteria.push({
      id: 'content_expectation',
      statement: `${paths[0]} contains ${JSON.stringify(quoted[1])}`,
      kind: 'content',
      path: paths[0],
      expectation: quoted[1],
    });
  }

  // 3. A JS/TS project must still compile.
  if (context.hasTypeScriptConfig) {
    criteria.push({
      id: 'typecheck',
      statement: 'TypeScript reports no errors',
      kind: 'typecheck',
      command: { binary: 'npx', args: ['tsc', '--noEmit'] },
    });
  } else if (isWebProject) {
    criteria.push({
      id: 'build',
      statement: 'The frontend production bundle builds',
      kind: 'build',
      command: { binary: 'npm', args: ['run', 'build:web'] },
    });
  }

  // 4. An explicit test-related request requires the suite to pass.
  const wantsTests = /\b(test|tests|spec|regression|passing)\b/.test(lower);
  if (wantsTests && context.hasTestScript) {
    criteria.push({
      id: 'tests',
      statement: 'The test suite passes',
      kind: 'tests',
      command: { binary: 'npm', args: ['test'] },
    });
  }

  // 5. Never pretend. If nothing above applies, the change cannot be verified
  //    automatically and the caller must say so rather than claim success.
  if (criteria.length === 0) {
    criteria.push({
      id: 'manual_review',
      statement: 'No automatic verification applies; a developer must review the diff',
      kind: 'manual',
    });
  }

  return criteria;
}

export interface CriterionOutcome {
  criterion: AcceptanceCriterion;
  satisfied: boolean;
  evidence: string;
}

/**
 * Check every criterion against real state. `runCommand` is injected so the
 * engine owns the sandboxed execution policy (allowlist, timeout, env stripping)
 * and this module stays pure.
 */
export async function verifyCriteria(
  criteria: AcceptanceCriterion[],
  context: CriterionProjectContext,
  runCommand: (binary: string, args: string[], timeoutMs: number) => Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>,
): Promise<CriterionOutcome[]> {
  const outcomes: CriterionOutcome[] = [];

  for (const criterion of criteria) {
    if (criterion.kind === 'manual') {
      outcomes.push({
        criterion,
        satisfied: false,
        evidence: 'Not automatically verifiable — reported as outstanding, not as a pass.',
      });
      continue;
    }

    if (criterion.kind === 'file_exists') {
      const target = path.resolve(context.root, criterion.path || '');
      const exists = target.startsWith(context.root) && fs.existsSync(target);
      outcomes.push({
        criterion,
        satisfied: exists,
        evidence: exists ? `Found ${criterion.path}` : `Missing ${criterion.path}`,
      });
      continue;
    }

    if (criterion.kind === 'content') {
      const target = path.resolve(context.root, criterion.path || '');
      let satisfied = false;
      let evidence = `Missing ${criterion.path}`;
      if (target.startsWith(context.root) && fs.existsSync(target)) {
        const body = fs.readFileSync(target, 'utf-8');
        satisfied = body.includes(criterion.expectation || '');
        evidence = satisfied
          ? `Found ${JSON.stringify(criterion.expectation)} in ${criterion.path}`
          : `${JSON.stringify(criterion.expectation)} not present in ${criterion.path}`;
      }
      outcomes.push({ criterion, satisfied, evidence });
      continue;
    }

    // Command-backed criteria.
    const command = criterion.command;
    if (!command) {
      outcomes.push({
        criterion,
        satisfied: false,
        evidence: 'No command configured for this criterion.',
      });
      continue;
    }

    const result = await runCommand(command.binary, command.args, 180_000);
    const tail = `${result.stdout}\n${result.stderr}`.trim().split('\n').slice(-12).join('\n');
    outcomes.push({
      criterion,
      satisfied: result.exitCode === 0,
      evidence: `exit ${result.exitCode}${tail ? `\n${tail}` : ''}`,
    });
  }

  return outcomes;
}
