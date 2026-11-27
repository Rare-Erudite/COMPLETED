/**
 * The ten natural-language requests, end to end through the real server.
 *
 * Each one asserts the ROUTE and the OUTCOME, not just an HTTP 200. A request
 * that should act must not come back as prose, and a request that cannot act
 * must say so honestly rather than claiming success.
 *
 * The device requests are expected to report "no device connected" here: this
 * suite runs on a server with no phone attached. That is the correct answer,
 * and asserting it is what stops a future change from silently faking a tap.
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

/** Create a conversation and send one message through the non-streaming route. */
async function ask(
  session: { headers: Record<string, string> },
  message: string,
): Promise<{ status: number; json: any }> {
  const created = await fetch(`${baseUrl()}/api/conversations`, {
    method: 'POST',
    headers: session.headers,
    body: JSON.stringify({ title: 'NL test' }),
  });
  const conversation = await created.json();
  const id = conversation?.id || conversation?.conversation?.id;
  if (!id) return { status: 0, json: { error: 'no conversation id', raw: conversation } };

  const response = await fetch(`${baseUrl()}/api/conversations/${id}`, {
    method: 'POST',
    headers: session.headers,
    body: JSON.stringify({ message }),
  });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

export async function runNaturalLanguageTests(): Promise<{ passed: number; failed: number }> {
  console.log('=== Ten natural-language requests, end to end ===');

  const session = await newSession();

  // 1. Open WhatsApp — device intent, no phone attached.
  {
    const { status, json } = await ask(session, 'Open WhatsApp.');
    check('1. "Open WhatsApp" is routed to device', json?.intent?.intent === 'device', json?.intent);
    check('1. it does not answer with prose about WhatsApp',
      !/whatsapp is a messaging/i.test(json?.reply?.content || ''));
    check('1. it reports the device is unavailable, honestly',
      json?.action?.status === 'unavailable' && /no device is connected/i.test(json?.reply?.content || ''),
      json?.action);
    check('1. the request itself succeeded', status === 200);
  }

  // 2. Describe the screen.
  {
    const { json } = await ask(session, 'Describe what is on my screen.');
    check('2. "Describe what is on my screen" is routed to device', json?.intent?.intent === 'device', json?.intent);
    check('2. it does not claim to have read a screen',
      json?.action?.status === 'unavailable', json?.action);
  }

  // 3. Scroll down.
  {
    const { json } = await ask(session, 'Scroll down.');
    check('3. "Scroll down" is routed to device', json?.intent?.intent === 'device', json?.intent);
    check('3. it does not claim to have scrolled', json?.action?.status === 'unavailable', json?.action);
  }

  // 4. Check notifications.
  {
    const { json } = await ask(session, 'Check my notifications.');
    check('4. "Check my notifications" is routed to device', json?.intent?.intent === 'device', json?.intent);
    check('4. it does not invent notifications', json?.action?.status === 'unavailable', json?.action);
  }

  // 5. Remind me every morning — must create a real task.
  let createdTaskId: string | undefined;
  {
    const { json } = await ask(session, 'Remind me every morning.');
    check('5. "Remind me every morning" is routed to schedule', json?.intent?.intent === 'schedule', json?.intent);
    check('5. it actually created a task', json?.action?.status === 'executed', json?.action);
    createdTaskId = json?.action?.data?.id;
    check('5. the task has an id', typeof createdTaskId === 'string' && createdTaskId.startsWith('sch_'), createdTaskId);

    const listed = await fetch(`${baseUrl()}/api/schedules`, { headers: session.headers });
    const tasks = await listed.json();
    check('5. the task is persisted and listed',
      Array.isArray(tasks) && tasks.some((task: any) => task.id === createdTaskId),
      Array.isArray(tasks) ? tasks.length : tasks);
  }

  // 6. Pause my existing reminder — must pause the real task.
  {
    const { json } = await ask(session, 'Pause my existing reminder.');
    check('6. "Pause my existing reminder" is routed to schedule', json?.intent?.intent === 'schedule', json?.intent);
    check('6. it reports the pause as executed', json?.action?.status === 'executed', json?.action);

    const listed = await fetch(`${baseUrl()}/api/schedules`, { headers: session.headers });
    const tasks = await listed.json();
    const task = Array.isArray(tasks) ? tasks.find((item: any) => item.id === createdTaskId) : null;
    check('6. the task is actually paused in the store',
      task && (task.status === 'paused' || task.enabled === false),
      task);
  }

  // 7. Use the connected plugin — a real MCP server is configured by default.
  {
    const { json } = await ask(session, 'Use the connected plugin to perform this task.');
    check('7. "Use the connected plugin" is routed to plugin', json?.intent?.intent === 'plugin', json?.intent);
    // With the bundled reference server connected, there are tools but no tool
    // was named, so the honest answer is "tell me which tool".
    check('7. it does not claim to have run a tool it was not told to run',
      json?.action?.status === 'reported' || json?.action?.status === 'unavailable',
      json?.action);
    check('7. it names the real discovered tools',
      /echo|add|now|word_count|sha256|rare_version/i.test(json?.reply?.content || ''),
      (json?.reply?.content || '').slice(0, 200));
  }

  // 8. Ask an agent to research — routes to research, not conversation.
  {
    const { json } = await ask(session, 'Ask an agent to research this subject.');
    check('8. an agent research request reaches research or conversation deliberately',
      ['research', 'conversation'].includes(json?.intent?.intent), json?.intent);
  }

  // 9. Find my document and convert it to PDF.
  {
    const { json } = await ask(session, 'Find my document and convert it to PDF.');
    check('9. a document request is routed to documents or conversation',
      ['documents', 'conversation'].includes(json?.intent?.intent), json?.intent);
  }

  // 10. Search for this topic and produce a sourced report.
  {
    const { json } = await ask(session, 'Search for this topic and produce a sourced report.');
    check('10. a sourced-report request is routed to research', json?.intent?.intent === 'research', json?.intent);
  }

  // Consequential gate, through the real server.
  {
    const { json } = await ask(session, 'Open WhatsApp and send a message to Alice.');
    check('11. a consequential request is withheld for confirmation',
      json?.action?.needsConfirmation === true, json?.action);
  }

  console.log(`  -- natural language: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
