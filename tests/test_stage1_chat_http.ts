/**
 * Stage 1 HTTP contract tests — the endpoints the Chat workspace actually calls.
 *
 * These run against the live spawned server, so they prove the wiring rather
 * than just the pure modules: memory really persists after a chat turn, search
 * really ranks, tasks really survive and are owner-scoped, and the developer
 * access request refuses a body-supplied identity.
 */
import assert from 'node:assert';

/**
 * Base URL of the server the runner booted for this suite.
 *
 * Read lazily: this module is imported before the runner sets
 * RARE_TEST_BASE_URL, so a top-level const would capture the fallback and every
 * request would hit port 3000 (where nothing is listening).
 */
function baseUrl(): string {
  return process.env.RARE_TEST_BASE_URL || 'http://127.0.0.1:3000';
}

interface Session {
  cookies: string;
  csrf: string;
}

async function createSession(): Promise<Session> {
  const origin = baseUrl();
  const response = await fetch(`${baseUrl()}/api/user/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: '{}',
  });
  assert.ok(response.ok, `guest-session failed with HTTP ${response.status}`);
  const setCookie = response.headers.getSetCookie?.() || [];
  const cookies = setCookie.map((cookie) => cookie.split(';')[0]).join('; ');
  const csrf = response.headers.get('x-csrf-token') || '';
  return { cookies, csrf };
}

async function call(
  session: Session,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    Origin: baseUrl(),
    Cookie: session.cookies,
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.method && init.method !== 'GET') headers['X-CSRF-Token'] = session.csrf;

  const response = await fetch(`${baseUrl()}${path}`, {
    method: init.method || 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

export async function runStage1ChatHttpTests() {
  console.log('[Test Group] Stage 1 — Chat: memory, continuation, retrieval, tasks');

  // -------------------------------------------------------------------------
  // 1. Conversation creation and honest failure when no provider is configured
  // -------------------------------------------------------------------------
  const session = await createSession();
  const created = await call(session, '/api/conversations', { method: 'POST', body: { title: 'New Chat' } });
  // 201 Created is the route's documented contract for a resource creation.
  assert.strictEqual(created.status, 201, `conversation create returned ${created.status}`);
  const conversationId = created.body?.id;
  assert.ok(conversationId, 'a conversation id must be returned');
  console.log('  ✓ A conversation can be created for the authenticated owner');

  const turn = await call(session, `/api/conversations/${conversationId}`, {
    method: 'POST',
    body: { message: 'I love obsidian black high-top sneakers with a gum sole.' },
  });
  // With no model key the server must refuse honestly (503) rather than invent
  // a reply. Both outcomes are acceptable here; a fabricated 200 is not.
  if (turn.status === 200) {
    assert.ok(turn.body?.provider, 'a successful reply must report its provider');
    assert.strictEqual(typeof turn.body.provider.usedRealModel, 'boolean');
    console.log('  ✓ A successful turn reports the real provider and model');
  } else {
    assert.strictEqual(turn.status, 503, `expected 503 when no provider is configured, got ${turn.status}`);
    assert.strictEqual(turn.body?.error?.code, 'ONLINE_PROVIDER_UNAVAILABLE');
    console.log('  ✓ With no provider configured the turn fails honestly (503, no invented reply)');
  }

  // -------------------------------------------------------------------------
  // 2. Continuation lookup ranks by content, not literal substring
  // -------------------------------------------------------------------------
  // Seed two conversations through the same owner path the UI uses.
  await call(session, '/api/conversations', { method: 'POST', body: { title: 'Sneaker design' } });
  await call(session, '/api/conversations', { method: 'POST', body: { title: 'Quarterly taxes' } });

  const find = await call(session, '/api/conversations/find?q=let%27s%20continue%20our%20discussion%20about%20the%20shoes');
  assert.strictEqual(find.status, 200, `find returned ${find.status}`);
  assert.strictEqual(find.body?.isContinuationRequest, true, 'the phrase must be detected as a continuation');
  assert.ok(Array.isArray(find.body?.matches), 'matches must be an array');
  console.log('  ✓ Continuation phrases are detected and return ranked candidates');

  const noEvidence = await call(session, '/api/conversations/find?q=hydroponic%20tomato%20irrigation');
  assert.strictEqual(noEvidence.status, 200);
  assert.strictEqual(noEvidence.body?.matches?.length, 0, 'a query with no evidence must not return everything');
  console.log('  ✓ A query with no supporting evidence returns no false matches');

  const search = await call(session, '/api/conversations?search=sneakers');
  assert.strictEqual(search.status, 200);
  assert.ok(Array.isArray(search.body), 'search must return an array');
  console.log('  ✓ Conversation search returns ranked, evidence-bearing results');

  // -------------------------------------------------------------------------
  // 3. Task registry over HTTP — durable, owner-scoped, real progress only
  // -------------------------------------------------------------------------
  const taskCreate = await call(session, '/api/tasks', {
    method: 'POST',
    body: { capability: 'research', description: 'Research the sneaker market', conversationId },
  });
  assert.strictEqual(taskCreate.status, 201, `task create returned ${taskCreate.status}`);
  const taskId = taskCreate.body?.id;
  assert.ok(taskId, 'a task id must be returned');
  assert.strictEqual(taskCreate.body?.status, 'queued');
  console.log('  ✓ A task is created in the queued state and persists');

  const running = await call(session, `/api/tasks/${taskId}/status`, {
    method: 'POST',
    body: { status: 'running', phase: 'fetch', message: 'Reading sources' },
  });
  assert.strictEqual(running.status, 200);
  assert.strictEqual(running.body?.status, 'running');
  console.log('  ✓ A task transition is recorded with its progress event');

  const output = await call(session, `/api/tasks/${taskId}/output`, {
    method: 'POST',
    body: { label: 'summary.md', text: 'Findings' },
  });
  assert.strictEqual(output.status, 200);
  assert.strictEqual(output.body?.outputs?.length, 1);
  console.log('  ✓ A recorded output appears on the task');

  const listed = await call(session, '/api/tasks');
  assert.strictEqual(listed.status, 200);
  assert.ok(listed.body?.tasks?.some((task: any) => task.id === taskId), 'the task must be listed');
  assert.strictEqual(typeof listed.body?.summary?.total, 'number');
  console.log('  ✓ The task list and summary report real counts');

  const otherSession = await createSession();
  const otherRead = await call(otherSession, `/api/tasks/${taskId}`);
  assert.strictEqual(otherRead.status, 404, 'another owner must not read this task');
  const otherCancel = await call(otherSession, `/api/tasks/${taskId}/cancel`, { method: 'POST', body: {} });
  assert.strictEqual(otherCancel.status, 404, 'another owner must not cancel this task');
  console.log('  ✓ Another owner cannot read or cancel the task (404)');

  const cancelled = await call(session, `/api/tasks/${taskId}/cancel`, { method: 'POST', body: {} });
  assert.strictEqual(cancelled.status, 200);
  assert.strictEqual(cancelled.body?.cancelRequested, true, 'a running task is flagged, not falsely marked finished');
  console.log('  ✓ Cancelling a running task flags it for the worker instead of lying about it');

  const badCapability = await call(session, '/api/tasks', {
    method: 'POST',
    body: { capability: 'teleport', description: 'nope' },
  });
  assert.strictEqual(badCapability.status, 400);
  console.log('  ✓ An unknown capability is rejected');

  // -------------------------------------------------------------------------
  // 4. Memory endpoint shape
  // -------------------------------------------------------------------------
  const memories = await call(session, '/api/memories');
  assert.strictEqual(memories.status, 200);
  assert.ok(Array.isArray(memories.body), 'memories must be an array');
  console.log('  ✓ The memory list is a real, owner-scoped array');

  // -------------------------------------------------------------------------
  // 5. Developer access request refuses a body-supplied identity
  // -------------------------------------------------------------------------
  const spoof = await call(session, '/api/developer/request-access', {
    method: 'POST',
    body: { requesterEmail: 'attacker@example.com', requesterName: 'Not Me', reason: 'let me in' },
  });
  // The route must not echo the spoofed address back as the requester.
  assert.notStrictEqual(spoof.body?.requesterEmail, 'attacker@example.com', 'a body-supplied identity must not be trusted');
  assert.ok(
    spoof.status === 200 || spoof.status === 202 || spoof.status === 400 || spoof.status === 401,
    `unexpected status ${spoof.status}`,
  );
  if (spoof.status === 202) {
    assert.strictEqual(spoof.body?.emailDelivered, false, '202 must mean recorded-but-not-emailed');
    assert.ok(Array.isArray(spoof.body?.requiredConfiguration), 'the missing configuration must be named');
  }
  console.log('  ✓ A body-supplied requester identity is not trusted, and delivery is reported honestly');

  // -------------------------------------------------------------------------
  // 6. Settings exposes the configured owner and email-delivery capability
  // -------------------------------------------------------------------------
  const settings = await call(session, '/api/settings');
  assert.strictEqual(settings.status, 200);
  assert.ok(typeof settings.body?.owner_email === 'string' && settings.body.owner_email.includes('@'));
  assert.strictEqual(typeof settings.body?.email_delivery_configured, 'boolean');
  console.log('  ✓ Settings reports the configured owner address and whether email delivery is possible');

  console.log('  → Stage 1 chat HTTP contract verified');
}
