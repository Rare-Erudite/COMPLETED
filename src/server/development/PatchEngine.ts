/**
 * RARE — Patch engine
 *
 * Produces and applies *real* textual changes to workspace files and reports a
 * real unified diff for each one. Before this module, the self-development path
 * claimed "Modify Source Files: Completed" without touching a single byte and
 * reported an always-empty changed-file list; nothing downstream could tell the
 * difference between a successful build and a no-op.
 *
 * Design constraints that come from the rest of RARE:
 *
 *  - Every write goes through `ToolExecutor.writeFile`, so path traversal, core
 *    file protection and developer authorization apply exactly as they do to
 *    any other tool call. This module never touches `fs` for writes itself.
 *  - A patch is all-or-nothing: every hunk is matched against the current file
 *    content before anything is written. A partial apply is worse than a failed
 *    one, because it leaves the workspace in a state no checkpoint describes.
 *  - The diff is computed from the bytes actually read and the bytes actually
 *    written, never from the request.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface FilePatch {
  /** Workspace-relative path. */
  path: string;
  /** 'create' when the file did not exist, 'modify' when it did. */
  operation: 'create' | 'modify' | 'delete';
  /** Exact text to find. Ignored for 'create' and 'delete'. */
  search?: string;
  /** Replacement text. For 'create', the whole file body. */
  replace?: string;
}

export interface AppliedPatch {
  path: string;
  operation: 'create' | 'modify' | 'delete';
  /** Real unified diff between the pre- and post-apply content. */
  diff: string;
  linesAdded: number;
  linesRemoved: number;
  bytesBefore: number;
  bytesAfter: number;
}

export interface PatchFailure {
  path: string;
  reason: string;
}

export interface PatchResult {
  applied: AppliedPatch[];
  failed: PatchFailure[];
  /** True only when every requested patch was applied. */
  complete: boolean;
}

/**
 * Minimal line-based LCS diff. Files here are source files; a Myers diff is not
 * worth the dependency, and this is deterministic for identical inputs.
 */
export function unifiedDiff(
  before: string,
  after: string,
  filePath: string,
  contextLines = 3,
): string {
  const a = before.length ? before.split('\n') : [];
  const b = after.length ? after.split('\n') : [];

  // LCS table — bounded because source files are small; guard huge inputs.
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) {
    return `--- a/${filePath}\n+++ b/${filePath}\n@@ full replacement (file too large for line diff) @@\n`;
  }

  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  type Op = { kind: ' ' | '-' | '+'; text: string; oldNo: number; newNo: number };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: ' ', text: a[i], oldNo: i + 1, newNo: j + 1 });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ kind: '-', text: a[i], oldNo: i + 1, newNo: j + 1 });
      i += 1;
    } else {
      ops.push({ kind: '+', text: b[j], oldNo: i + 1, newNo: j + 1 });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ kind: '-', text: a[i], oldNo: i + 1, newNo: j + 1 });
    i += 1;
  }
  while (j < m) {
    ops.push({ kind: '+', text: b[j], oldNo: i + 1, newNo: j + 1 });
    j += 1;
  }

  // Group into hunks with context.
  const changed = ops
    .map((op, index) => (op.kind === ' ' ? -1 : index))
    .filter((index) => index !== -1);

  if (changed.length === 0) return '';

  const ranges: Array<[number, number]> = [];
  let start = Math.max(0, changed[0] - contextLines);
  let end = Math.min(ops.length - 1, changed[0] + contextLines);
  for (const index of changed.slice(1)) {
    if (index - contextLines <= end + 1) {
      end = Math.min(ops.length - 1, index + contextLines);
    } else {
      ranges.push([start, end]);
      start = Math.max(0, index - contextLines);
      end = Math.min(ops.length - 1, index + contextLines);
    }
  }
  ranges.push([start, end]);

  let out = `--- a/${filePath}\n+++ b/${filePath}\n`;
  for (const [from, to] of ranges) {
    const slice = ops.slice(from, to + 1);
    const oldStart = slice.find((op) => op.kind !== '+')?.oldNo ?? slice[0].oldNo;
    const newStart = slice.find((op) => op.kind !== '-')?.newNo ?? slice[0].newNo;
    const oldCount = slice.filter((op) => op.kind !== '+').length;
    const newCount = slice.filter((op) => op.kind !== '-').length;
    out += `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n`;
    for (const op of slice) out += `${op.kind}${op.text}\n`;
  }
  return out;
}

/** Resolve a workspace-relative path, refusing anything that escapes the root. */
export function resolveWorkspacePath(root: string, relativePath: string): string | null {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') return null;

  // Absolute paths are never workspace-relative.
  if (path.isAbsolute(relativePath)) return null;

  // Reject any traversal before normalising. `path.normalize` collapses
  // 'a/../../etc/passwd' to '../etc/passwd', which then resolves *outside* the
  // root; but when the root is shallow ('../etc/passwd' from /tmp/x lands on
  // /tmp/etc/passwd) the resolved path is still inside and a prefix check alone
  // would wrongly accept it. Refusing the input is the only reliable rule.
  const segments = relativePath.split(/[/\\]+/);
  if (segments.some((segment) => segment === '..')) return null;

  const full = path.resolve(root, relativePath);
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) return null;
  return full;
}

export interface PatchWriter {
  /** Write through the permission-controlled tool layer. Throws on refusal. */
  write(relativePath: string, content: string): Promise<void>;
  /** Delete through the same layer. */
  remove(relativePath: string): Promise<void>;
}

/**
 * Apply patches atomically against `root`.
 *
 * All hunks are validated first: a `search` block that does not appear exactly
 * once in the current file aborts the whole batch, so the caller can restore a
 * checkpoint without having to reason about a half-applied edit.
 */
export async function applyPatches(
  root: string,
  patches: FilePatch[],
  writer: PatchWriter,
): Promise<PatchResult> {
  const staged: Array<{ patch: FilePatch; before: string; after: string }> = [];
  const failed: PatchFailure[] = [];

  for (const patch of patches) {
    const full = resolveWorkspacePath(root, patch.path);
    if (!full) {
      failed.push({ path: patch.path, reason: 'Path escapes the workspace root.' });
      continue;
    }

    const exists = fs.existsSync(full);
    const before = exists && fs.statSync(full).isFile() ? fs.readFileSync(full, 'utf-8') : '';

    if (patch.operation === 'create') {
      if (exists) {
        failed.push({ path: patch.path, reason: 'Refusing to overwrite an existing file with a create patch.' });
        continue;
      }
      if (typeof patch.replace !== 'string') {
        failed.push({ path: patch.path, reason: 'Create patch has no content.' });
        continue;
      }
      staged.push({ patch, before: '', after: patch.replace });
      continue;
    }

    if (patch.operation === 'delete') {
      if (!exists) {
        failed.push({ path: patch.path, reason: 'File does not exist.' });
        continue;
      }
      staged.push({ patch, before, after: '' });
      continue;
    }

    // modify
    if (!exists) {
      failed.push({ path: patch.path, reason: 'File does not exist.' });
      continue;
    }
    if (typeof patch.search !== 'string' || patch.search === '') {
      failed.push({ path: patch.path, reason: 'Modify patch has no search text.' });
      continue;
    }
    if (typeof patch.replace !== 'string') {
      failed.push({ path: patch.path, reason: 'Modify patch has no replacement text.' });
      continue;
    }

    const occurrences = before.split(patch.search).length - 1;
    if (occurrences === 0) {
      failed.push({
        path: patch.path,
        reason: 'Search text was not found — the file changed since it was read.',
      });
      continue;
    }
    if (occurrences > 1) {
      failed.push({
        path: patch.path,
        reason: `Search text is ambiguous (${occurrences} matches); include more surrounding context.`,
      });
      continue;
    }

    staged.push({ patch, before, after: before.replace(patch.search, patch.replace) });
  }

  // Any validation failure aborts the batch before a single byte is written.
  if (failed.length > 0) {
    return { applied: [], failed, complete: false };
  }

  const applied: AppliedPatch[] = [];
  for (const { patch, before, after } of staged) {
    try {
      if (patch.operation === 'delete') {
        await writer.remove(patch.path);
      } else {
        await writer.write(patch.path, after);
      }
    } catch (error: any) {
      failed.push({ path: patch.path, reason: error?.message || String(error) });
      // Stop: later patches may depend on this one.
      break;
    }

    const diff = unifiedDiff(before, after, patch.path);
    const linesAdded = diff.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).length;
    const linesRemoved = diff.split('\n').filter((line) => line.startsWith('-') && !line.startsWith('---')).length;

    applied.push({
      path: patch.path,
      operation: patch.operation,
      diff,
      linesAdded,
      linesRemoved,
      bytesBefore: Buffer.byteLength(before, 'utf-8'),
      bytesAfter: Buffer.byteLength(after, 'utf-8'),
    });
  }

  return { applied, failed, complete: failed.length === 0 };
}
