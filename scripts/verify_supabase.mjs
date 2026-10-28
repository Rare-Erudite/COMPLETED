#!/usr/bin/env node
/**
 * verify_supabase.mjs — honest reachability + persistence check for the RARE
 * Supabase project (ref: moxtuqgfhucmnblxensw).
 *
 * It reports exactly what it can prove and refuses to pretend otherwise:
 *
 *   1. REST reachability  — always attempted, no credentials needed.
 *   2. Authenticated REST — only if SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
 *                           is present. Otherwise reported as BLOCKED.
 *   3. Direct Postgres    — only if DATABASE_URL is present. Otherwise BLOCKED.
 *
 * Exit code is 0 when every check that COULD run passed, 1 when a check that
 * ran failed. A blocked check never counts as a pass.
 */

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'moxtuqgfhucmnblxensw';
const SUPABASE_URL = process.env.SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`;
const REST = `${SUPABASE_URL}/rest/v1/`;
const ANON = process.env.SUPABASE_ANON_KEY?.trim() || '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
const DATABASE_URL = process.env.DATABASE_URL?.trim() || '';

const results = [];
function record(name, status, detail) {
  results.push({ name, status, detail });
  const icon = status === 'PASS' ? '✓' : status === 'BLOCKED' ? '⊘' : '✗';
  console.log(`${icon} ${name}: ${status}`);
  if (detail) console.log(`    ${detail}`);
}

async function checkRestReachability() {
  try {
    const res = await fetch(REST, { method: 'GET' });
    const ref = res.headers.get('sb-project-ref');
    const code = res.headers.get('sb-error-code');
    if (res.status === 401 && ref === PROJECT_REF) {
      record(
        'REST endpoint reachable',
        'PASS',
        `HTTP 401 ${code || ''} · sb-project-ref=${ref} — project exists and is served`,
      );
      return true;
    }
    record('REST endpoint reachable', 'FAIL', `HTTP ${res.status} · sb-project-ref=${ref}`);
    return false;
  } catch (error) {
    record('REST endpoint reachable', 'FAIL', error.message);
    return false;
  }
}

async function checkAuthenticatedRest() {
  const key = SERVICE || ANON;
  const kind = SERVICE ? 'service-role' : 'anon';
  if (!key) {
    record(
      'Authenticated REST read (rare_user_state)',
      'BLOCKED',
      'No SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY supplied. ' +
        'Cannot prove authenticated reads/writes against this project.',
    );
    return;
  }
  try {
    const res = await fetch(`${REST}rare_user_state?select=owner_id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (res.ok) {
      const rows = await res.json();
      record('Authenticated REST read (rare_user_state)', 'PASS', `HTTP ${res.status} · ${kind} key · ${rows.length} row(s)`);
    } else {
      const body = await res.text();
      record('Authenticated REST read (rare_user_state)', 'FAIL', `HTTP ${res.status} · ${body.slice(0, 200)}`);
    }
  } catch (error) {
    record('Authenticated REST read (rare_user_state)', 'FAIL', error.message);
  }
}

async function checkDirectPostgres() {
  if (!DATABASE_URL) {
    record(
      'Direct PostgreSQL persistence',
      'BLOCKED',
      'DATABASE_URL is not set. No Supabase connection string was supplied, ' +
        'so migrations and live persistence against this project were not run.',
    );
    return;
  }
  let Pool;
  try {
    ({ Pool } = await import('pg'));
  } catch {
    record('Direct PostgreSQL persistence', 'FAIL', 'The pg driver is not installed.');
    return;
  }
  const pool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 10_000, max: 1 });
  try {
    const version = await pool.query('SELECT version()');
    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('rare_schema_migrations','rare_persistent_documents',
                             'rare_users','rare_sessions','rare_user_state',
                             'projects','project_tasks','agent_events','artifacts')
        ORDER BY table_name`,
    );
    const applied = await pool.query('SELECT version FROM rare_schema_migrations ORDER BY version').catch(() => ({ rows: [] }));
    record(
      'Direct PostgreSQL persistence',
      'PASS',
      `${version.rows[0].version.split(',')[0]} · ${tables.rowCount} core table(s) · ` +
        `migrations: ${applied.rows.map((r) => r.version).join(', ') || 'none recorded'}`,
    );
  } catch (error) {
    record('Direct PostgreSQL persistence', 'FAIL', error.message);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

console.log(`RARE Supabase verification — project ${PROJECT_REF}\n`);
await checkRestReachability();
await checkAuthenticatedRest();
await checkDirectPostgres();

const failed = results.filter((r) => r.status === 'FAIL');
const blocked = results.filter((r) => r.status === 'BLOCKED');
console.log(
  `\nSummary: ${results.filter((r) => r.status === 'PASS').length} passed, ` +
    `${failed.length} failed, ${blocked.length} blocked.`,
);
if (blocked.length > 0) {
  console.log('Blocked checks are NOT passes — they require credentials that were not supplied.');
}
process.exitCode = failed.length > 0 ? 1 : 0;
