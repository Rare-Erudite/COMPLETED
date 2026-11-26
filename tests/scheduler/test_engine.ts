/**
 * RARE — Scheduler engine end-to-end test.
 *
 * Exercises the real engine, the real dispatcher and the real command queue
 * against an in-memory store and a SIMULATED Android device. The simulation is
 * explicit: `FakeDevice` stands in for the phone's poll loop. Everything else
 * (tick, claim, lease, dispatch, checkpoint dedupe, retry, restart) is the
 * production code path.
 *
 * Run: npx tsx tests/scheduler/test_engine.ts
 */

import { ScheduleEngine, initialiseTask } from '../../src/server/scheduler/ScheduleEngine.js';
import type { ScheduledTask } from '../../src/server/scheduler/ScheduleEngine.js';
import { LocalScheduleStore } from '../../src/server/scheduler/ScheduleStore.js';
import { StoreDeviceCommandQueue } from '../../src/server/scheduler/DeviceCommandQueue.js';
import { createDispatcher } from '../../src/server/scheduler/dispatcher.js';

// ---------------------------------------------------------------------------
// In-memory store with the same contract as PersistentJsonStore
// ---------------------------------------------------------------------------

class MemoryStore {
  private docs = new Map<string, unknown>();
  async getOwnedState<T>(ownerId: string, key: string, initial: T): Promise<T> {
    const k = `${ownerId}:${key}`;
    if (!this.docs.has(k)) this.docs.set(k, structuredClone(initial));
    return structuredClone(this.docs.get(k)) as T;
  }
  async updateOwnedState<T>(ownerId: string, key: string, initial: T, fn: (cur: T) => T): Promise<T> {
    const k = `${ownerId}:${key}`;
    const cur = this.docs.has(k) ? (this.docs.get(k) as T) : structuredClone(initial);
    const next = fn(structuredClone(cur));
    this.docs.set(k, structuredClone(next));
    return next;
  }
}

// ---------------------------------------------------------------------------
// Simulated Android device
// ---------------------------------------------------------------------------

class FakeDevice {
  online = true;
  notifications: any[] = [];
  failNext = false;
  executed: string[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private queue: StoreDeviceCommandQueue,
    private ownerId: string,
    private pollMs = 200,
  ) {}

  start() {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.pollMs);
    this.timer.unref?.();
  }
  /** One synchronous poll, used to make tests deterministic. */
  async pump() { await this.poll(); }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async poll() {
    if (!this.online) return;
    await this.queue.recordPresence(this.ownerId, { platform: 'android', sdk: 33 });
    const commands = await this.queue.claimPending(this.ownerId, 5);
    for (const cmd of commands) {
      this.executed.push(cmd.action);
      if (this.failNext) {
        this.failNext = false;
        await this.queue.complete(this.ownerId, cmd.id, {
          ok: false,
          error: 'accessibility service not enabled',
        });
        continue;
      }
      if (cmd.action === 'notifications') {
        await this.queue.complete(this.ownerId, cmd.id, {
          ok: true,
          result: { ok: true, data: { notifications: this.notifications } },
        });
      } else {
        await this.queue.complete(this.ownerId, cmd.id, {
          ok: true,
          result: { ok: true, message: `${cmd.action} executed` },
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ''}`); }
}

const OWNER = 'usr_test_owner';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const store = new MemoryStore();
  const queue = new StoreDeviceCommandQueue(store as any);
  const device = new FakeDevice(queue, OWNER, 50);
  device.start();

  const dispatcher = createDispatcher({ deviceQueue: queue, deviceTimeoutMs: 5000 });
  const persistence = new LocalScheduleStore(store as any);

  // A controllable clock so we can drive "every 2 minutes" without waiting.
  let clock = Date.UTC(2026, 10, 26, 12, 0, 0);
  const engine = new ScheduleEngine(persistence, dispatcher, {
    tickMs: 100_000, // we call tick() manually
    leaseMs: 30_000,
    maxFailures: 3,
    now: () => clock,
    workerId: 'test_worker',
  });

  console.log('=== 1. create a recurring WhatsApp monitoring task ===');
  const init = initialiseTask({
    id: 'sch_whatsapp',
    title: 'WhatsApp new-message check',
    time: 'every 2 minutes',
    type: 'recurring',
    action: 'Every two minutes, check WhatsApp for new incoming messages and tell me what has arrived.',
    enabled: true,
    repeat: 'Every 2 minutes',
    created_at: new Date(clock).toISOString(),
    schedule: 'every 2 minutes',
    timezone: 'Africa/Lagos',
    action_kind: 'notification_check',
    action_config: { package: 'com.whatsapp', limit: 50 },
    owner_id: OWNER,
  } as any, clock);
  if ('error' in init) { console.log('  FAIL  init:', init.error); process.exit(1); }
  const task = init.task as ScheduledTask & { owner_id: string };
  await persistence.save(task);
  check('task persisted', (await persistence.listAll()).length === 1);
  check('next_run_at set', Boolean(task.next_run_at), task.next_run_at ?? '');
  check('starts active', task.status === 'active');

  console.log('\n=== 2. not due yet -> nothing runs ===');
  let report = await engine.tick();
  check('no execution before due time', report.executed === 0, `scanned=${report.scanned} executed=${report.executed}`);

  console.log('\n=== 3. advance to due time -> real action executes ===');
  device.notifications = [
    { package: 'com.whatsapp', title: 'Ada', text: 'Are we still on for 3pm?', postedAt: 1000 },
    { package: 'com.whatsapp', title: 'Team', text: 'Deploy finished', postedAt: 1001 },
    { package: 'com.android.systemui', title: 'Battery', text: '20%', postedAt: 1002 },
  ];
  clock += 120_000;
  report = await engine.tick();
  check('one task executed', report.executed === 1, `executed=${report.executed} ok=${report.succeeded}`);
  check('device actually received a command', device.executed.includes('notifications'), `executed=${device.executed.join(',')}`);

  let all = await persistence.listAll();
  let t = all[0];
  check('run_count incremented', t.run_count === 1, `run_count=${t.run_count}`);
  check('last_status success', t.last_status === 'success');
  const firstSummary = t.history?.[0]?.summary ?? '';
  check('reported 2 WhatsApp messages (filtered out systemui)', firstSummary.includes('2 new notification'), firstSummary.split('\n')[0]);
  check('checkpoint stored seen ids', Array.isArray(t.checkpoint?.seenNotificationIds) && (t.checkpoint!.seenNotificationIds as string[]).length === 2,
    `seen=${(t.checkpoint?.seenNotificationIds as string[] | undefined)?.length}`);
  check('next run advanced', Date.parse(t.next_run_at!) > clock, t.next_run_at!);

  console.log('\n=== 4. duplicate prevention: same notifications, next run ===');
  clock += 120_000;
  report = await engine.tick();
  all = await persistence.listAll();
  t = all[0];
  const secondSummary = t.history?.[0]?.summary ?? '';
  check('second run executed', report.executed === 1);
  check('no new messages reported', secondSummary.includes('no new ones'), secondSummary);
  check('run_count is 2', t.run_count === 2, `run_count=${t.run_count}`);

  console.log('\n=== 5. a genuinely new message is detected ===');
  device.notifications = [
    { package: 'com.whatsapp', title: 'Ada', text: 'Are we still on for 3pm?', postedAt: 1000 },
    { package: 'com.whatsapp', title: 'Team', text: 'Deploy finished', postedAt: 1001 },
    { package: 'com.whatsapp', title: 'Bola', text: 'Sent the invoice', postedAt: 2000 },
  ];
  clock += 120_000;
  await engine.tick();
  all = await persistence.listAll();
  t = all[0];
  const thirdSummary = t.history?.[0]?.summary ?? '';
  check('exactly 1 new message', thirdSummary.includes('1 new notification'), thirdSummary.split('\n')[0]);
  check('names the new sender', thirdSummary.includes('Bola'));

  console.log('\n=== 6. device offline -> honest failure, not fake success ===');
  device.online = false;
  all = await persistence.listAll();
  await persistence.save({ ...all[0], consecutive_failures: 0, status: 'active' });
  clock += 120_000;
  await engine.tick();
  all = await persistence.listAll();
  t = all[0];
  const offlineExec = t.history?.[0];
  check('run marked failed', offlineExec?.status === 'failed', `status=${offlineExec?.status}`);
  // Presence was still fresh, so the honest outcome is a timeout, not "offline".
  // Either way it must be a device-related failure, never a fake success.
  check('error is device-related', /device_(offline|timeout)/.test(String(offlineExec?.error ?? '')), String(offlineExec?.error));
  check('summary blames the device, not a fake check', /device|did not answer|did not check/i.test(String(offlineExec?.summary ?? '')), String(offlineExec?.summary).slice(0, 70));
  check('consecutive_failures = 1', t.consecutive_failures === 1, `cf=${t.consecutive_failures}`);
  check('retry scheduled with backoff', Date.parse(t.next_run_at!) > clock, `next=${t.next_run_at}`);

  console.log('\n=== 6b. presence stale -> reports device_offline explicitly ===');
  // Simulate the phone having stopped polling long ago (and keep it stopped so
  // its heartbeat cannot refresh presence mid-test).
  device.online = false;
  await store.updateOwnedState(OWNER, 'device_presence', {}, () => ({
    lastSeenAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  }));
  all = await persistence.listAll();
  await persistence.save({ ...all[0], consecutive_failures: 0, status: 'active', next_run_at: new Date(clock).toISOString() });
  await engine.tick();
  all = await persistence.listAll();
  t = all[0];
  const staleExec = t.history?.[0];
  check('stale presence -> device_offline', String(staleExec?.error ?? '').includes('device_offline'), String(staleExec?.error));
  check('stale presence -> says nothing was checked', String(staleExec?.summary ?? '').includes('did not check anything'));

  console.log('\n=== 7. device returns an error -> surfaced verbatim ===');
  device.online = true;
  // Let the heartbeat refresh presence before the next run.
  await device.pump();
  await device.pump();
  device.failNext = true;
  all = await persistence.listAll();
  t = all[0];
  clock = t.next_run_at ? Date.parse(t.next_run_at) : clock + 60_000;
  await engine.tick();
  all = await persistence.listAll();
  t = all[0];
  const errExec = t.history?.[0];
  check('device error surfaced', String(errExec?.error ?? '').includes('accessibility'), String(errExec?.error));

  console.log('\n=== 8. pause -> does not run ===');
  t = { ...t, status: 'paused', enabled: true };
  await persistence.save(t);
  clock += 120_000;
  report = await engine.tick();
  check('paused task skipped', report.executed === 0, `executed=${report.executed}`);

  console.log('\n=== 9. resume -> runs again ===');
  all = await persistence.listAll();
  t = { ...all[0], status: 'active', next_run_at: new Date(clock).toISOString() };
  await persistence.save(t);
  report = await engine.tick();
  check('resumed task executed', report.executed === 1, `executed=${report.executed}`);

  console.log('\n=== 10. restart: new engine instance picks up persisted state ===');
  const engine2 = new ScheduleEngine(persistence, dispatcher, {
    tickMs: 100_000, leaseMs: 30_000, maxFailures: 3, now: () => clock, workerId: 'worker_after_restart',
  });
  all = await persistence.listAll();
  t = all[0];
  const runsBefore = t.run_count ?? 0;
  clock += 120_000;
  report = await engine2.tick();
  all = await persistence.listAll();
  t = all[0];
  check('new engine executed the task', report.executed === 1, `executed=${report.executed}`);
  check('run_count continued from persisted state', (t.run_count ?? 0) === runsBefore + 1, `${runsBefore} -> ${t.run_count}`);
  check('history survived restart', (t.history?.length ?? 0) >= 3, `history=${t.history?.length}`);

  console.log('\n=== 11. missed-run recovery: engine was down for an hour ===');
  all = await persistence.listAll();
  t = { ...all[0], next_run_at: new Date(clock - 3_600_000).toISOString(), status: 'active' };
  await persistence.save(t);
  const runsBeforeMiss = t.run_count ?? 0;
  report = await engine2.tick();
  all = await persistence.listAll();
  t = all[0];
  check('missed run recorded', report.missed === 1, `missed=${report.missed}`);
  check('did NOT replay the backlog', (t.run_count ?? 0) === runsBeforeMiss, `run_count stayed ${t.run_count}`);
  check('history entry says missed', t.history?.[0]?.status === 'missed', t.history?.[0]?.summary?.slice(0, 60));
  check('jumped to a future slot', Date.parse(t.next_run_at!) > clock, t.next_run_at!);

  console.log('\n=== 12. duplicate execution prevented by the lease ===');
  all = await persistence.listAll();
  t = { ...all[0], next_run_at: new Date(clock).toISOString(), status: 'active' };
  await persistence.save(t);
  // Claim it as another worker, then try to tick.
  const stolen = await persistence.claim(t.id, 'other_worker', 60_000, clock);
  check('other worker holds the lease', stolen !== null);
  report = await engine2.tick();
  check('engine skipped the leased task', report.executed === 0 && report.skipped >= 1,
    `executed=${report.executed} skipped=${report.skipped}`);
  await persistence.release(t.id, 'other_worker');

  console.log('\n=== 13. run-now bypasses the due check ===');
  all = await persistence.listAll();
  t = { ...all[0], next_run_at: new Date(clock + 10_000_000).toISOString(), status: 'active' };
  await persistence.save(t);
  const before = t.run_count ?? 0;
  const exec = await engine2.runNow(t.id);
  all = await persistence.listAll();
  t = all[0];
  check('run-now produced an execution', exec !== null, exec?.status ?? 'null');
  check('run-now incremented run_count', (t.run_count ?? 0) === before + 1, `${before} -> ${t.run_count}`);

  console.log('\n=== 14. failure parking after maxFailures ===');
  device.online = false;
  all = await persistence.listAll();
  t = { ...all[0], consecutive_failures: 2, status: 'active', next_run_at: new Date(clock).toISOString() };
  await persistence.save(t);
  await engine2.tick();
  all = await persistence.listAll();
  t = all[0];
  check('task parked as failed after 3 consecutive failures', t.status === 'failed', `status=${t.status}`);
  check('no next run when parked', t.next_run_at === null, String(t.next_run_at));

  console.log('\n=== 15. cancel (delete) ===');
  const removed = await persistence.delete(t.id, OWNER);
  check('task deleted', removed === true);
  check('store is empty', (await persistence.listAll()).length === 0);

  console.log('\n=== 16. one-time schedule completes ===');
  const onceInit = initialiseTask({
    id: 'sch_once', title: 'One-off', time: '2026-11-26T13:00:00Z', type: 'reminder',
    action: 'Remind me', enabled: true, repeat: 'Once',
    created_at: new Date(clock).toISOString(),
    schedule: '2026-11-26T13:00:00Z', timezone: 'UTC',
    action_kind: 'report', action_config: {}, owner_id: OWNER,
  } as any, clock);
  if ('error' in onceInit) { console.log('  FAIL  once init:', onceInit.error); }
  else {
    await persistence.save(onceInit.task as any);
    clock = Date.parse('2026-11-26T13:00:00Z');
    await engine2.tick();
    const onceTask = (await persistence.listAll())[0];
    check('one-off ran', (onceTask.run_count ?? 0) === 1, `run_count=${onceTask.run_count}`);
    check('one-off completed, no next run', onceTask.status === 'completed' && onceTask.next_run_at === null,
      `status=${onceTask.status} next=${onceTask.next_run_at}`);
  }

  device.stop();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('FATAL', error);
  process.exit(1);
});
