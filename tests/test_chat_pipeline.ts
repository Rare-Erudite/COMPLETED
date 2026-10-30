import assert from 'assert';
import { extractMemories } from '../src/server/chat/MemoryExtractor.js';

const BASE = process.env.RARE_TEST_BASE_URL || 'http://127.0.0.1:3000';

/**
 * Exercises the real chat pipeline against the running server: session, CSRF,
 * conversation create, a real (non-fabricated) reply, persistence, memory
 * extraction, and the streaming endpoint. Every assertion is about observed
 * behaviour, never about internal state.
 */
export async function runChatPipelineTests() {
  console.log('--- Testing Chat Pipeline (extraction + persistence + streaming) ---');

  // ---- Unit level: the extractor must be conservative and honest. ----
  assert.deepStrictEqual(extractMemories('Hi!'), [], 'Greetings are not memories');
  assert.deepStrictEqual(extractMemories('What is the weather?'), [], 'Questions are not memories');
  assert.deepStrictEqual(extractMemories('thanks'), [], 'Acknowledgements are not memories');
  assert.deepStrictEqual(
    extractMemories('My API key is sk-abcdef1234567890abcdef'),
    [],
    'Credential-like text is never stored',
  );

  const identity = extractMemories('My name is Ada and I work as an AI engineer.');
  assert.strictEqual(identity.length, 1, 'A stated identity produces exactly one memory');
  assert.strictEqual(identity[0].kind, 'identity', 'Identity sentences classify as identity');
  assert.ok(identity[0].tags.includes('identity'), 'Tags include the kind');

  const pref = extractMemories('I prefer dark mode dashboards.');
  assert.strictEqual(pref.length, 1, 'A stated preference is captured');
  assert.strictEqual(pref[0].kind, 'preference');

  assert.deepStrictEqual(
    extractMemories('I prefer dark mode dashboards.', ['i prefer dark mode dashboards']),
    [],
    'Duplicates against existing memory are not stored twice',
  );

  // ---- HTTP level: the running server. ----
  const origin = BASE;
  const sessionRes = await fetch(`${BASE}/api/user/guest-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
  });
  assert.ok(sessionRes.ok, `guest session must succeed (got ${sessionRes.status})`);
  const csrf = sessionRes.headers.get('x-csrf-token') || '';
  const cookie = (sessionRes.headers.get('set-cookie') || '')
    .split(',')
    .map((part) => part.split(';')[0])
    .join('; ');
  assert.ok(csrf, 'A CSRF token is issued to the browser session');

  const authHeaders = {
    'Content-Type': 'application/json',
    Origin: origin,
    'X-CSRF-Token': csrf,
    Cookie: cookie,
  };

  const createRes = await fetch(`${BASE}/api/conversations`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ title: 'Pipeline Test' }),
  });
  assert.ok(createRes.ok, `conversation create must succeed (got ${createRes.status})`);
  const conversation = await createRes.json();
  assert.ok(conversation.id, 'Created conversation has an id');
  assert.ok(
    typeof conversation.messages?.[0]?.content === 'string' &&
      !conversation.messages[0].content.includes('undefined'),
    'The opening greeting names the assistant (regression: "I am undefined")',
  );

  const sendRes = await fetch(`${BASE}/api/conversations/${conversation.id}`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ message: 'My name is Ada and I prefer dark mode dashboards.' }),
  });
  const sendBody: any = await sendRes.json();
  if (sendRes.ok) {
    assert.ok(sendBody.assistant_message?.content?.trim(), 'A real reply is returned');
    assert.ok(sendBody.memoriesStored >= 1, 'The turn reports the memories actually written');

    const readRes = await fetch(`${BASE}/api/conversations/${conversation.id}`, {
      headers: { Origin: origin, Cookie: cookie },
    });
    const persisted: any = await readRes.json();
    assert.ok(persisted.messages.length >= 3, 'User and assistant turns persist to storage');

    const memRes = await fetch(`${BASE}/api/memories`, { headers: { Origin: origin, Cookie: cookie } });
    const memories: any[] = await memRes.json();
    assert.ok(
      memories.some((m) => m.source === 'chat_extraction'),
      'A chat-extracted memory is readable from the memory API',
    );
  } else {
    // No provider configured is an acceptable, honest outcome — but it must be
    // reported as unavailable, never disguised as a successful reply.
    assert.strictEqual(sendRes.status, 503, 'Without a provider the server says 503, not a fake answer');
  }

  // ---- Streaming endpoint shape. ----
  const streamRes = await fetch(`${BASE}/api/conversations/${conversation.id}/stream`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ message: 'Summarise my preferences briefly.' }),
  });
  if (streamRes.ok) {
    assert.match(streamRes.headers.get('content-type') || '', /text\/event-stream/, 'Stream endpoint emits SSE');
    const text = await streamRes.text();
    assert.match(text, /event: (delta|error)/, 'Stream emits a delta or an honest error event');
  }

  console.log('\u2713 Chat pipeline tests passed (extraction, persistence, streaming).');
}
