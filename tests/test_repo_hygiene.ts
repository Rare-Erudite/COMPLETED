import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

/**
 * Repository hygiene guard.
 *
 * Two real incidents are locked down here so they cannot silently return:
 *
 *  1. `.rare/state/persistent-documents.json` — the file-backed store holding
 *     every user account and password hash — was committed to this PUBLIC
 *     repository and became downloadable by anyone. It must never be tracked.
 *  2. `.rare/checkpoints/**` — full source snapshots written by the checkpoint
 *     tool — were tracked despite being gitignored, adding thousands of files
 *     and unbounded growth. They must never be tracked.
 *
 * The test reads the real git index, so it fails the moment either path is
 * staged or committed again.
 */
export async function runRepoHygieneTests(): Promise<void> {
  console.log('\n[repo-hygiene]');

  let tracked: string[] = [];
  try {
    const out = execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    tracked = out.split('\n').filter(Boolean);
  } catch {
    console.log('  SKIP — not a git checkout; cannot inspect the index.');
    return;
  }

  const stateBlob = tracked.filter((p) => p === '.rare/state/persistent-documents.json');
  assert.equal(
    stateBlob.length,
    0,
    'The credential store .rare/state/persistent-documents.json must never be tracked in this public repository.',
  );
  console.log('  ✓ the credential store is not tracked');

  const checkpoints = tracked.filter((p) => p.startsWith('.rare/checkpoints/'));
  assert.equal(
    checkpoints.length,
    0,
    `Checkpoint snapshots must never be tracked (found ${checkpoints.length} tracked files under .rare/checkpoints/).`,
  );
  console.log('  ✓ no checkpoint snapshots are tracked');

  const anyState = tracked.filter((p) => p.startsWith('.rare/state/'));
  assert.equal(anyState.length, 0, 'Nothing under .rare/state/ may be tracked.');
  console.log('  ✓ nothing under .rare/state/ is tracked');
}
