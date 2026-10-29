/**
 * RARE — patch planning from a natural-language instruction
 *
 * The self-development engine can apply patches and verify them, but it needs
 * *concrete* patches. The `/api/developer/self-dev` route accepted an
 * instruction and no planner, so a natural-language request produced zero
 * patches and the engine correctly refused — which looked like the Assistant
 * "not being connected" rather than a missing planner.
 *
 * This module supplies that planner. It is deliberately conservative:
 *
 *   - It only proposes changes it can ground in real file content it has read.
 *   - It never invents a `search` block. A modify patch whose `search` text is
 *     not present in the file is rejected by PatchEngine, so guessing would
 *     just produce a confusing failure later.
 *   - When it cannot ground a change, it returns an empty list *with a reason*,
 *     and the caller reports the blocker instead of fabricating a patch.
 *
 * A model-backed planner can be layered on top later; this deterministic one
 * is what makes the path work today without depending on provider availability.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { FilePatch } from '../development/PatchEngine.js';

export interface PlanResult {
  patches: FilePatch[];
  /** Why no patches were produced, when that is the case. */
  blocker?: string;
  /** Files the planner actually read to ground its proposal. */
  inspected: string[];
}

const projectRoot = (): string => path.resolve(process.env.RARE_APP_ROOT || process.cwd());

/** Files that are safe to consider for an automated change. */
const EDITABLE_ROOTS = ['src/', 'server.ts', 'api/'];

function isEditable(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  if (normalized.includes('..')) return false;
  if (normalized.startsWith('.rare/')) return false;
  if (normalized.startsWith('node_modules/')) return false;
  return EDITABLE_ROOTS.some((root) => normalized === root || normalized.startsWith(root));
}

function readIfExists(relPath: string): string | null {
  const absolute = path.join(projectRoot(), relPath);
  try {
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return null;
    return fs.readFileSync(absolute, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Extract candidate file paths mentioned in the instruction, e.g.
 * "fix the retry logic in src/server/tools/ToolExecutor.ts".
 */
function mentionedPaths(instruction: string): string[] {
  const found = new Set<string>();
  const pattern = /(?:^|[\s`'"(])((?:src|api)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|css|json)|server\.ts)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(instruction)) !== null) {
    if (isEditable(match[1])) found.add(match[1]);
  }
  return [...found];
}

/**
 * Build a plan for an instruction.
 *
 * Supported, grounded operations:
 *   - "add a comment/note ... to <file>"  → modify, anchored on a real line
 *   - "create <file> with ..."            → create
 *   - "delete <file>"                     → delete
 *
 * Anything else returns a blocker. That is the honest outcome: the engine will
 * report "no concrete change could be derived" rather than claiming success.
 */
export function planPatches(instruction: string): PlanResult {
  const text = (instruction || '').trim();
  const inspected: string[] = [];

  if (!text) {
    return { patches: [], blocker: 'The instruction was empty.', inspected };
  }

  const targets = mentionedPaths(text);
  if (targets.length === 0) {
    return {
      patches: [],
      blocker:
        'No editable file was named in the request. Name the file to change ' +
        '(for example "src/server/tools/ToolExecutor.ts") so the change can be grounded in real content.',
      inspected,
    };
  }

  const patches: FilePatch[] = [];

  for (const target of targets) {
    const existing = readIfExists(target);
    if (existing !== null) inspected.push(target);

    // --- delete -----------------------------------------------------------
    if (/\b(delete|remove)\b/i.test(text) && new RegExp(`\\b${escapeRegExp(path.basename(target))}\\b`, 'i').test(text)) {
      if (existing === null) {
        return { patches: [], blocker: `${target} does not exist, so it cannot be deleted.`, inspected };
      }
      patches.push({ path: target, operation: 'delete' });
      continue;
    }

    // --- create -----------------------------------------------------------
    if (/\b(create|add a new file|new file)\b/i.test(text) && existing === null) {
      const body = extractFencedBlock(text);
      if (!body) {
        return {
          patches: [],
          blocker: `Creating ${target} needs the file body in a fenced code block so the content is explicit.`,
          inspected,
        };
      }
      patches.push({ path: target, operation: 'create', replace: body });
      continue;
    }

    // --- modify -----------------------------------------------------------
    if (existing === null) {
      return { patches: [], blocker: `${target} was not found in the workspace.`, inspected };
    }

    const anchor = chooseAnchor(existing, text);
    if (!anchor) {
      return {
        patches: [],
        blocker:
          `Could not find a unique, real anchor in ${target} for this change. ` +
          'A modify patch must quote existing text exactly; guessing would corrupt the file.',
        inspected,
      };
    }

    const addition = extractFencedBlock(text) ?? buildComment(text);
    patches.push({
      path: target,
      operation: 'modify',
      search: anchor,
      replace: `${anchor}\n${addition}`,
    });
  }

  if (patches.length === 0) {
    return { patches: [], blocker: 'No grounded change could be derived from the request.', inspected };
  }

  return { patches, inspected };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Pull the first fenced code block out of the instruction, if present. */
function extractFencedBlock(text: string): string | null {
  const match = text.match(/```[a-zA-Z0-9]*\n([\s\S]*?)```/);
  return match ? match[1].replace(/\s+$/, '') : null;
}

/**
 * Choose a real, unique line from the file to anchor an insertion on.
 *
 * Preference order: a line containing a term from the instruction, then the
 * first import line, then the first non-empty line. The anchor must appear
 * exactly once or PatchEngine will reject the patch, so uniqueness is checked
 * here rather than discovered later.
 */
function chooseAnchor(content: string, instruction: string): string | null {
  const lines = content.split('\n');
  const terms = (instruction.toLowerCase().match(/[a-z][a-z0-9_]{3,}/g) || []).filter(
    (term) => !['the', 'this', 'that', 'with', 'from', 'into', 'file', 'code', 'change', 'please', 'make'].includes(term),
  );

  const candidates: string[] = [];
  for (const term of terms) {
    const hit = lines.find((line) => line.trim().length > 8 && line.toLowerCase().includes(term));
    if (hit) candidates.push(hit);
  }
  const firstImport = lines.find((line) => /^import\s/.test(line));
  if (firstImport) candidates.push(firstImport);
  const firstCode = lines.find((line) => line.trim().length > 8);
  if (firstCode) candidates.push(firstCode);

  for (const candidate of candidates) {
    const occurrences = content.split(candidate).length - 1;
    if (occurrences === 1) return candidate;
  }
  return null;
}

/** Fall back to a comment when the instruction carries no code block. */
function buildComment(instruction: string): string {
  const summary = instruction.replace(/\s+/g, ' ').slice(0, 160).replace(/\*\//g, '* /');
  return `// RARE self-build: ${summary}`;
}
