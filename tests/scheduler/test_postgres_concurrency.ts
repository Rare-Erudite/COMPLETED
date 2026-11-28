/**
 * RARE — PostgreSQL scheduler concurrency acceptance.
 *
 * Runs against a REAL PostgreSQL server (no mocks, no in-memory substitute).
 * Two independent PostgresScheduleStore instances stand in for two workers,
 * each with its own connection pool, so the claim race is decided by the
 * database itself rather than by shared process state.
 *
 * Set RARE_TEST_DATABASE_URL to a reachable PostgreSQL connection string.
 * The test creates and drops its own table; it never touches production data.
 */

import { Pool } from 'pg';
import { PostgresScheduleStore } from '../../src/server/scheduler/ScheduleStore.js';
import type { ScheduledTask } from '../../src/server/scheduler/ScheduleEngine.js';

const CONN = process.env.RARE_TEST_DATABASE_URL || process.env.DATABASE_URL || '';

interface Result {
  name: string;
  status: 'PASS' | 'FAIL' | 'BLOCKED';
  detail: string;
}

const results: Result[] = [];

function record(name: string, status: Result['status'], detail: string) {
  results.push({ name, status, detail });
  const mark = status === 'PASS' ? 'PASS' : status === 'FAIL' ? 'FAIL' : 'BLOCK';
  console.log(`  [${mark}] ${name} — ${detail}`);
}

function task(id: string, owner = 'owner_test'): ScheduledTask {
  return {
    // save() reads owner_id off the task itself; without it the row lands
    // under the reserved scheduler owner and owner-scoped delete cannot match.
    owner_id: owner,
    id,
    title: `task ${id}`,
    time: '08:00',
    type: 'recurring',
    action: 'noop',
    enabled: true,
    repeat: 'daily',
    created_at: new Date().toISOString(),
    schedule: '0 8 * * *',
    timezone: 'UTC',
    status: 'active',
    next_run_at: new Date().toISOString(),
    run_count: 0,
    failure_count: 0,
    consecutive_failures: 0,
  } as ScheduledTask;
}

async function main() {
  if (!CONN) {
    record(
      'PostgreSQL reachable',
      'BLOCKED',
      'No RARE_TEST_DATABASE_URL / DATABASE_URL in the environment. Only the owner can supply a connection, and it must arrive through a secure channel — never pasted into a message or committed to the repository.',
    );
    console.log('\nBLOCKED: no database connection available.');
    process.exit(0);
  }

  // Prove the connection is real before claiming anything about it.
  const probe = new Pool({ connectionString: CONN, connectionTimeoutMillis: 10_000 });
  try {
    const v = await probe.query<{ version: string }>('SELECT version()');
    record('PostgreSQL reachable', 'PASS', v.rows[0].version.split(',')[0]);
  } catch (error) {
    record(
      'PostgreSQL reachable',
      'BLOCKED',
      `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    await probe.end().catch(() => undefined);
    process.exit(0);
  }
  await probe.end().catch(() => undefined);

  const workerA = new PostgresScheduleStore(CONN);
  const workerB = new PostgresScheduleStore(CONN);
  await workerA.ensureSchema();
  await workerB.ensureSchema();

  const cleanup = new Pool({ connectionString: CONN });
  const wipe = async () => {
    await cleanup.query("DELETE FROM rare_scheduled_tasks WHERE owner_id = 'owner_test'");
  };
  await wipe();

  const LEASE = 2_000;

  // --- 1. Two workers race for one task: exactly one winner -----------------
  try {
    await workerA.save(task('race_1'));
    const now = Date.now();
    const [a, b] = await Promise.all([
      workerA.claim('race_1', 'worker-A', LEASE, now),
      workerB.claim('race_1', 'worker-B', LEASE, now),
    ]);
    const winners = [a, b].filter(Boolean);
    const winner = a ? 'worker-A' : b ? 'worker-B' : 'none';
    record(
      'Two workers, one task — exactly one claim',
      winners.length === 1 ? 'PASS' : 'FAIL',
      `winners=${winners.length} (${winner}); A=${a ? 'claimed' : 'null'} B=${b ? 'claimed' : 'null'}`,
    );
  } catch (error) {
    record('Two workers, one task — exactly one claim', 'FAIL', String(error));
  }

  // --- 2. No duplicate execution: loser cannot re-claim a live lease --------
  try {
    const again = await workerB.claim('race_1', 'worker-B', LEASE, Date.now());
    record(
      'Live lease blocks a second claim (no duplicate execution)',
      again === null ? 'PASS' : 'FAIL',
      again === null ? 'second claim correctly refused' : 'second claim SUCCEEDED — duplicate execution possible',
    );
  } catch (error) {
    record('Live lease blocks a second claim (no duplicate execution)', 'FAIL', String(error));
  }

  // --- 3. Worker termination during a lease: lease survives, then expires ---
  try {
    // worker-A "dies" here: it never calls release(). The row keeps its lease.
    const beforeExpiry = await workerB.claim('race_1', 'worker-B', LEASE, Date.now());
    const blocked = beforeExpiry === null;

    // Wait past the lease, then reclaim as a fresh worker.
    await new Promise((r) => setTimeout(r, LEASE + 1_200));
    const afterExpiry = await workerB.claim('race_1', 'worker-B', LEASE, Date.now());

    record(
      'Worker termination — lease expires and is reclaimed',
      blocked && afterExpiry !== null ? 'PASS' : 'FAIL',
      `blocked while lease live=${blocked}; reclaimed after expiry=${afterExpiry !== null}`,
    );
  } catch (error) {
    record('Worker termination — lease expires and is reclaimed', 'FAIL', String(error));
  }

  // --- 4. Restart recovery: a brand-new store sees persisted state ----------
  try {
    const fresh = new PostgresScheduleStore(CONN);
    await fresh.ensureSchema();
    const all = await fresh.listAll();
    const found = all.find((t) => t.id === 'race_1');
    record(
      'Restart recovery — new process reads persisted task',
      found ? 'PASS' : 'FAIL',
      found ? `task race_1 recovered (status=${found.status})` : 'task not found after restart',
    );
    await fresh.close();
  } catch (error) {
    record('Restart recovery — new process reads persisted task', 'FAIL', String(error));
  }

  // --- 5. Persisted history: run counters survive a round trip --------------
  try {
    const t = task('history_1');
    t.run_count = 7;
    t.last_run_at = new Date().toISOString();
    t.last_status = 'success';
    await workerA.save(t);
    const fresh = new PostgresScheduleStore(CONN);
    const all = await fresh.listAll();
    const back = all.find((x) => x.id === 'history_1');
    record(
      'Persisted history survives restart',
      back?.run_count === 7 && back?.last_status === 'success' ? 'PASS' : 'FAIL',
      `run_count=${back?.run_count} last_status=${back?.last_status}`,
    );
    await fresh.close();
  } catch (error) {
    record('Persisted history survives restart', 'FAIL', String(error));
  }

  // --- 6. Concurrent scheduling: many tasks, many workers, no double-claim --
  try {
    const N = 40;
    for (let i = 0; i < N; i += 1) await workerA.save(task(`bulk_${i}`));

    const now = Date.now();
    const claims = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        Promise.all([
          workerA.claim(`bulk_${i}`, 'worker-A', LEASE, now),
          workerB.claim(`bulk_${i}`, 'worker-B', LEASE, now),
        ]),
      ),
    );
    const doubleClaimed = claims.filter(([a, b]) => a && b).length;
    const claimed = claims.filter(([a, b]) => a || b).length;
    record(
      'Concurrent scheduling — 40 tasks, 2 workers, zero double-claims',
      doubleClaimed === 0 && claimed === N ? 'PASS' : 'FAIL',
      `claimed=${claimed}/${N} doubleClaimed=${doubleClaimed}`,
    );
  } catch (error) {
    record('Concurrent scheduling — 40 tasks, 2 workers, zero double-claims', 'FAIL', String(error));
  }

  // --- 7. Owner isolation on delete ----------------------------------------
  try {
    await workerA.save(task('iso_1', 'owner_test'));
    const wrongOwner = await workerA.delete('iso_1', 'someone_else');
    const rightOwner = await workerA.delete('iso_1', 'owner_test');
    record(
      'Delete is owner-scoped',
      wrongOwner === false && rightOwner === true ? 'PASS' : 'FAIL',
      `wrongOwner=${wrongOwner} rightOwner=${rightOwner}`,
    );
  } catch (error) {
    record('Delete is owner-scoped', 'FAIL', String(error));
  }

  await wipe();
  await workerA.close();
  await workerB.close();
  await cleanup.end().catch(() => undefined);

  const failed = results.filter((r) => r.status === 'FAIL').length;
  const passed = results.filter((r) => r.status === 'PASS').length;
  console.log(`\nPostgreSQL concurrency: ${passed} passed, ${failed} failed, ${results.length} total`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('Fatal:', error);
  process.exit(1);
});
