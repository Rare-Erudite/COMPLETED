/**
 * Scheduler capability — end-to-end through the real server.
 *
 * This proves the path Chat and the Assistant use: a natural-language request
 * becomes a capability invocation, which creates a REAL persisted task in the
 * same store the engine ticks against. It is not a unit test of the parser.
 *
 * What it deliberately does NOT claim: that a device executed anything. The
 * device channel is exercised separately; here the assertion is that the task
 * exists, is owned, can be paused/resumed/run/deleted, and that another
 * account cannot touch it.
 */

const baseUrl = (): string => process.env.RARE_TEST_BASE_URL || 'http://127.0.0.1:3000';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    const message = `${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`;
    failures.push(message);
    console.log(`  FAIL ${message}`);
  }
}

async function newSession(): Promise<{ headers: Record<string, string> }> {
  const response = await fetch(`${baseUrl()}/api/user/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const raw = typeof (response.headers as any).getSetCookie === 'function'
    ? ((response.headers as any).getSetCookie() as string[])
    : (response.headers.get('set-cookie') || '').split(/, (?=[^;,]+=)/g);
  const cookies = raw.map((value) => value.split(';', 1)[0]).filter(Boolean);
  const csrfCookie = cookies.find((value) => value.startsWith('rare_csrf='));
  const csrf = response.headers.get('x-csrf-token') || csrfCookie?.slice('rare_csrf='.length) || '';
  return {
    headers: {
      'Content-Type': 'application/json',
      Origin: baseUrl(),
      Cookie: cookies.join('; '),
      'X-CSRF-Token': decodeURIComponent(csrf),
    },
  };
}

async function invoke(
  session: { headers: Record<string, string> },
  capabilityId: string,
  args: Record<string, unknown>,
): Promise<{ status: number; json: any }> {
  const response = await fetch(`${baseUrl()}/api/capabilities/invoke`, {
    method: 'POST',
    headers: session.headers,
    body: JSON.stringify({ capabilityId, args }),
  });
  const text = await response.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: response.status, json };
}

export async function runSchedulerCapabilityTests(): Promise<{ passed: number; failed: number }> {
  console.log('=== Scheduler capability (real server, real store) ===');

  const session = await newSession();
  check('guest session established', Boolean(session.headers.Cookie));
  if (!session.headers.Cookie) return { passed, failed: failed + 1 };

  // --- the capability is registered ---------------------------------------
  const catalogue = await fetch(`${baseUrl()}/api/capabilities`, { headers: session.headers });
  const catalogueJson: any = await catalogue.json();
  const ids: string[] = (catalogueJson.capabilities || []).map((c: any) => c.id);
  check('scheduler.manage is registered', ids.includes('scheduler.manage'), ids.filter((id) => id.startsWith('sched')));
  // departments() returns { department, count } descriptors, not bare strings.
  const departmentNames: string[] = (catalogueJson.departments || []).map((d: any) =>
    typeof d === 'string' ? d : d?.department,
  );
  check('the scheduler department is exposed', departmentNames.includes('scheduler'), departmentNames);

  // --- create through the capability, not the HTTP route -------------------
  const created = await invoke(session, 'scheduler.manage', {
    operation: 'create',
    title: 'WhatsApp watch',
    instruction: 'Check WhatsApp for new incoming messages and tell me what has arrived.',
    schedule: 'every 2 minutes',
  });
  check('create returns 200', created.status === 200, created.status);
  check('create reports success', created.json?.ok === true, created.json?.summary);
  const taskId = created.json?.data?.id;
  check('create returns a task id', typeof taskId === 'string' && taskId.startsWith('sch_'), taskId);
  check('the task carries the instruction', /WhatsApp/.test(created.json?.data?.action || ''), created.json?.data?.action);
  check('the task has a next run time', Boolean(created.json?.data?.next_run_at), created.json?.data?.next_run_at);

  // --- it is really persisted, and visible through the HTTP route ----------
  const listed = await fetch(`${baseUrl()}/api/schedules`, { headers: session.headers });
  const listedJson: any = await listed.json();
  const found = Array.isArray(listedJson) ? listedJson.find((t: any) => t.id === taskId) : null;
  check('the created task is persisted and listed', Boolean(found), Array.isArray(listedJson) ? listedJson.length : listedJson);
  check('the persisted task keeps its schedule expression', found?.schedule === 'every 2 minutes', found?.schedule);

  // --- pause / resume ------------------------------------------------------
  const paused = await invoke(session, 'scheduler.manage', { operation: 'pause', id: taskId });
  check('pause succeeds', paused.json?.ok === true, paused.json?.summary);
  const afterPause = await fetch(`${baseUrl()}/api/schedules`, { headers: session.headers });
  const afterPauseJson: any = await afterPause.json();
  const pausedTask = afterPauseJson.find((t: any) => t.id === taskId);
  check('a paused task is marked paused', pausedTask?.status === 'paused', pausedTask?.status);

  const resumed = await invoke(session, 'scheduler.manage', { operation: 'resume', id: taskId });
  check('resume succeeds', resumed.json?.ok === true, resumed.json?.summary);
  const afterResume = await fetch(`${baseUrl()}/api/schedules`, { headers: session.headers });
  const afterResumeJson: any = await afterResume.json();
  const resumedTask = afterResumeJson.find((t: any) => t.id === taskId);
  check('a resumed task is active again', resumedTask?.status === 'active', resumedTask?.status);
  check('resume recomputes a future run', Boolean(resumedTask?.next_run_at), resumedTask?.next_run_at);

  // --- run-now executes through the engine --------------------------------
  // With no device attached the honest outcome is a FAILED execution that says
  // the device was unreachable — not a fake success.
  const ran = await invoke(session, 'scheduler.manage', { operation: 'run', id: taskId });
  check('run-now responds', ran.status === 200 || ran.status === 422, ran.status);
  const execution = ran.json?.data;
  check('run-now produces an execution record', Boolean(execution && (execution.id || execution.status)), execution);
  check(
    'run-now does not claim success without a device',
    !execution || execution.status !== 'success' || Boolean(execution.result),
    execution?.status,
  );

  // --- ownership isolation -------------------------------------------------
  const other = await newSession();
  const foreignPause = await invoke(other, 'scheduler.manage', { operation: 'pause', id: taskId });
  check('another account cannot pause this task', foreignPause.json?.ok === false, foreignPause.json?.summary);
  const foreignList = await fetch(`${baseUrl()}/api/schedules`, { headers: other.headers });
  const foreignListJson: any = await foreignList.json();
  check(
    'another account does not see this task',
    Array.isArray(foreignListJson) && !foreignListJson.some((t: any) => t.id === taskId),
    Array.isArray(foreignListJson) ? foreignListJson.length : foreignListJson,
  );

  // --- validation ----------------------------------------------------------
  const badOp = await invoke(session, 'scheduler.manage', { operation: 'explode' });
  check('an unknown operation is rejected', badOp.json?.ok === false, badOp.json?.summary);
  const noSchedule = await invoke(session, 'scheduler.manage', { operation: 'create', instruction: 'do something' });
  check('create without a schedule is rejected', noSchedule.json?.ok === false, noSchedule.json?.summary);

  // --- delete --------------------------------------------------------------
  const deleted = await invoke(session, 'scheduler.manage', { operation: 'delete', id: taskId });
  check('delete succeeds', deleted.json?.ok === true, deleted.json?.summary);
  const afterDelete = await fetch(`${baseUrl()}/api/schedules`, { headers: session.headers });
  const afterDeleteJson: any = await afterDelete.json();
  check(
    'the deleted task is gone',
    Array.isArray(afterDeleteJson) && !afterDeleteJson.some((t: any) => t.id === taskId),
    Array.isArray(afterDeleteJson) ? afterDeleteJson.length : afterDeleteJson,
  );

  console.log(`\nScheduler capability: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('Failures:');
    for (const failure of failures) console.log(`  - ${failure}`);
  }
  return { passed, failed };
}

if (process.argv[1]?.includes('test_scheduler_capability')) {
  runSchedulerCapabilityTests()
    .then(({ failed: total }) => process.exit(total > 0 ? 1 : 0))
    .catch((error) => {
      console.error('Scheduler capability tests crashed:', error);
      process.exit(1);
    });
}
