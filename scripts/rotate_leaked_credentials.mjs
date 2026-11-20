#!/usr/bin/env node
/**
 * Credential-blob remediation.
 *
 * `.rare/state/persistent-documents.json` was committed to this public
 * repository and is still present in git history. Untracking it (done in the
 * previous pass) stops future exposure but does NOT undo the leak: every
 * password hash in that blob must be treated as public.
 *
 * This script performs the part that can be done without rewriting history:
 *
 *   1. Invalidates every stored password hash (sets it to NULL) so a leaked
 *      hash can never authenticate, in both the file store and Postgres.
 *   2. Deletes every session row, so any session token derived from the leaked
 *      state is dead.
 *   3. Writes a machine-readable report of what it changed.
 *
 * It does NOT rewrite git history. Purging the blob from history requires a
 * force-push, which is a destructive, owner-controlled action; see
 * docs/SECURITY_REMEDIATION.md for the exact command and the reason it is not
 * run automatically.
 *
 * Usage:
 *   node scripts/rotate_leaked_credentials.mjs [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STATE_FILE = path.join(ROOT, '.rare', 'state', 'persistent-documents.json');
const DRY_RUN = process.argv.includes('--dry-run');

const report = {
  ranAt: new Date().toISOString(),
  dryRun: DRY_RUN,
  fileStore: { path: STATE_FILE, found: false, usersScanned: 0, hashesCleared: 0, sessionsCleared: 0 },
  postgres: { configured: false, usersUpdated: 0, sessionsDeleted: 0, error: null },
};

function rotateFileStore() {
  if (!fs.existsSync(STATE_FILE)) {
    report.fileStore.found = false;
    return;
  }
  report.fileStore.found = true;
  const raw = fs.readFileSync(STATE_FILE, 'utf8');
  const data = JSON.parse(raw);

  const users = Array.isArray(data.registered_users) ? data.registered_users : [];
  report.fileStore.usersScanned = users.length;
  for (const entry of users) {
    const record = Array.isArray(entry) ? entry[1] : entry;
    if (record && typeof record === 'object' && 'passwordHash' in record && record.passwordHash) {
      record.passwordHash = null;
      report.fileStore.hashesCleared += 1;
    }
  }

  const sessions = Array.isArray(data.user_sessions) ? data.user_sessions : [];
  report.fileStore.sessionsCleared = sessions.length;
  data.user_sessions = [];

  if (!DRY_RUN) {
    // Write atomically: a half-written credential store is worse than none.
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, STATE_FILE);
  }
}

async function rotatePostgres() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    report.postgres.error = 'DATABASE_URL is not set; Postgres was not touched.';
    return;
  }
  report.postgres.configured = true;
  let pg;
  try {
    pg = await import('pg');
  } catch (error) {
    report.postgres.error = `pg is not installed: ${error.message}`;
    return;
  }
  const client = new pg.default.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    if (DRY_RUN) {
      const users = await client.query('SELECT count(*)::int AS n FROM rare_users WHERE password_hash IS NOT NULL');
      const sessions = await client.query('SELECT count(*)::int AS n FROM rare_sessions');
      report.postgres.usersUpdated = users.rows[0]?.n ?? 0;
      report.postgres.sessionsDeleted = sessions.rows[0]?.n ?? 0;
    } else {
      const updated = await client.query('UPDATE rare_users SET password_hash = NULL WHERE password_hash IS NOT NULL');
      const deleted = await client.query('DELETE FROM rare_sessions');
      report.postgres.usersUpdated = updated.rowCount ?? 0;
      report.postgres.sessionsDeleted = deleted.rowCount ?? 0;
    }
  } catch (error) {
    report.postgres.error = error.message;
  } finally {
    try { await client.end(); } catch { /* already closed */ }
  }
}

async function main() {
  rotateFileStore();
  await rotatePostgres();
  const outDir = process.env.RARE_ROTATION_REPORT_DIR || path.join(ROOT, '..', 'documents', 'rare-complete');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'credential-rotation-report.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nReport written to ${path.relative(ROOT, outFile)}`);
}

main().catch((error) => {
  console.error('Credential rotation failed:', error);
  process.exit(1);
});
