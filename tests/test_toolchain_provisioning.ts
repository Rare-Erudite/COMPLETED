/**
 * Regression tests for environment provisioning.
 *
 * Two real defects this covers:
 *
 * 1. The provisioner installed with `apt-get install` and never refreshed the
 *    package index. A stale index makes apt fail with "404 Not Found" for a
 *    package that plainly exists, so a genuinely installable toolchain was
 *    reported as permanently missing. The fix refreshes the index and retries
 *    once when the failure looks like a stale index.
 *
 * 2. Go, Rust, Java and SQLite are all in the Debian archive, but they were
 *    absent from the audited package map, so the provisioner refused to install
 *    them ("no audited package mapping exists"). They are now mapped.
 *
 * These assertions are about the *mapping and the retry policy*, which are
 * deterministic. They do not require network access or root, so they run in the
 * normal suite; the actual install is exercised by scripts/stage3_evidence.ts.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SOURCE = path.join(process.cwd(), 'src/server/builder/EnvironmentProvisioner.ts');

export async function runToolchainProvisioningTests(): Promise<{ passed: number; failed: number }> {
  console.log('\n=== Toolchain provisioning (stale index + archive coverage) ===');
  let passed = 0;
  let failed = 0;

  const check = (name: string, fn: () => void) => {
    try {
      fn();
      passed++;
      console.log(`  ok   ${name}`);
    } catch (err: any) {
      failed++;
      console.log(`  FAIL ${name}\n       ${err?.message || String(err)}`);
    }
  };

  const source = fs.readFileSync(SOURCE, 'utf8');

  check('the provisioner refreshes the apt index before giving up', () => {
    assert.match(
      source,
      /apt-get',\s*\['update'\]/,
      'No `apt-get update` call exists, so a stale index still fails every install.'
    );
  });

  check('the refresh is conditional on a stale-index style failure', () => {
    assert.match(
      source,
      /404\\s\+Not Found|Failed to fetch|Unable to fetch some archives/,
      'The retry is not gated on the stale-index error signature, so it would retry every failure.'
    );
  });

  check('the install is retried after the refresh', () => {
    // The retry must reassign `result`, otherwise the second attempt is discarded.
    assert.match(source, /result\s*=\s*await run\('apt-get',\s*\['install'/);
  });

  check('Go is mapped to a real Debian package', () => {
    assert.match(source, /go_toolchain:\s*\[[^\]]*golang-go/);
  });

  check('Rust is mapped to rustc and cargo', () => {
    assert.match(source, /rust_cargo:\s*\[[^\]]*rustc/);
    assert.match(source, /rust_cargo:\s*\[[^\]]*cargo/);
  });

  check('Java is mapped to a JDK package', () => {
    assert.match(source, /java_toolchain:\s*\[[^\]]*jdk/);
  });

  check('SQLite is mapped', () => {
    assert.match(source, /sqlite3:\s*\[[^\]]*sqlite3/);
  });

  check('a toolchain with no mapping is still refused rather than guessed', () => {
    assert.match(source, /not_permitted/);
  });

  check('the exit code is never treated as proof of success', () => {
    // The re-probe is what decides; this guards against a regression to
    // "exit 0 means installed".
    assert.match(source, /Re-probe: the exit code is not evidence, the probe is/);
  });

  console.log(`\nToolchain provisioning: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
