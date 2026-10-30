/**
 * Stage 1 (Chat) regression tests.
 *
 * Each test pins one defect the audit found, so a future change that
 * reintroduces it fails here rather than silently shipping.
 */
import assert from 'node:assert';
import { extractMemories, mergeMemories, isSensitive } from '../src/server/chat/MemoryExtractor.js';
import {
  buildConversationContext,
  buildResumeBrief,
  findRelevantConversations,
  isContinuationRequest,
  queryTerms,
} from '../src/server/chat/ConversationRetrieval.js';
import { taskRegistry, type RareTask } from '../src/server/chat/TaskRegistry.js';
import { getOwnerEmail, isOwnerAccount, DEFAULT_OWNER_EMAIL } from '../src/server/chat/OwnerIdentity.js';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn();
    if (result instanceof Promise) throw new Error('async tests must use testAsync');
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error: any) {
    failed += 1;
    failures.push(name);
    console.error(`  ✗ ${name}: ${error?.message || error}`);
  }
}

async function testAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error: any) {
    failed += 1;
    failures.push(name);
    console.error(`  ✗ ${name}: ${error?.message || error}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

/**
 * Runs the Stage 1 pure unit suites. Throws on failure so the shared runner
 * reports a real failure rather than a green log line.
 */
export async function runStage1ChatTests(): Promise<void> {
// ---------------------------------------------------------------------------
section('MemoryExtractor — captures what the user actually asserted');
// ---------------------------------------------------------------------------
test('captures a stated preference', () => {
  const memories = extractMemories('I love obsidian black high-top sneakers with a gum sole.');
  assert.ok(memories.length >= 1, 'expected at least one memory');
  assert.strictEqual(memories[0].kind, 'preference');
  assert.ok(memories[0].text.toLowerCase().includes('sneakers'));
});

test('captures a project decision', () => {
  const memories = extractMemories('We decided to use Supabase for the persistence layer.');
  assert.strictEqual(memories[0]?.kind, 'project_decision');
});

test('captures a technical constraint', () => {
  const memories = extractMemories('We use typescript across the whole repository.');
  assert.strictEqual(memories[0]?.kind, 'technical_constraint');
});

test('captures a "let us discuss" topic', () => {
  const memories = extractMemories('Let us discuss shoes. I love obsidian black high-top sneakers with a gum sole.');
  assert.ok(memories.length >= 1);
  assert.ok(memories.some((memory) => /sneakers/i.test(memory.text)));
});

test('does NOT capture a question', () => {
  const memories = extractMemories('What did I just tell you about sneakers?');
  assert.strictEqual(memories.length, 0, 'a question is not a memory');
});

test('does NOT capture a task instruction', () => {
  const memories = extractMemories('Please build me a dashboard that shows revenue.');
  assert.strictEqual(memories.length, 0, 'an instruction is not a memory');
});

test('does NOT capture small talk', () => {
  assert.strictEqual(extractMemories('Hello there, good morning.').length, 0);
  assert.strictEqual(extractMemories('thanks').length, 0);
});

test('never captures a credential', () => {
  assert.strictEqual(extractMemories('My password is hunter2super').length, 0);
  assert.strictEqual(extractMemories('my api key is sk_live_abcdef1234567890').length, 0);
  assert.strictEqual(isSensitive('password: hunter2'), true);
  assert.strictEqual(isSensitive('I love tea'), false);
});

test('rejects an empty or tiny message', () => {
  assert.strictEqual(extractMemories('').length, 0);
  assert.strictEqual(extractMemories('hi').length, 0);
});

test('produces stable fingerprints for identical statements', () => {
  const first = extractMemories('I prefer dark themes with high contrast.');
  const second = extractMemories('I prefer dark themes with high contrast.');
  assert.strictEqual(first[0].fingerprint, second[0].fingerprint);
});

// ---------------------------------------------------------------------------
section('mergeMemories — dedupes and reports added records truthfully');
// ---------------------------------------------------------------------------
test('merge reports zero additions on a duplicate', () => {
  const first = mergeMemories([], extractMemories('I prefer dark themes with high contrast.'));
  assert.strictEqual(first.added.length, 1);
  const second = mergeMemories(first.next, extractMemories('I prefer dark themes with high contrast.'));
  assert.strictEqual(second.added.length, 0, 'duplicate must not be added twice');
  assert.strictEqual(second.next.length, 1);
});

test('merged records carry provenance and an unverified marker', () => {
  const merged = mergeMemories([], extractMemories('I prefer dark themes with high contrast.'), () => '2026-01-01T00:00:00.000Z');
  const record = merged.added[0];
  assert.strictEqual(record.source, 'system_inferred');
  assert.strictEqual(record.verifiedByUser, false);
  assert.strictEqual(record.timestamp, '2026-01-01T00:00:00.000Z');
  assert.ok(Array.isArray(record.tags));
});

// ---------------------------------------------------------------------------
section('Continuation detection');
// ---------------------------------------------------------------------------
test('recognises explicit continuation requests', () => {
  for (const phrase of [
    "let's continue our discussion about the shoes",
    'continue our conversation on sneakers',
    'resume our chat about the design',
    'pick up where we left off',
    'in our previous chat about shoes',
    'our earlier discussion about the sneakers',
  ]) {
    assert.strictEqual(isContinuationRequest(phrase), true, `should detect: ${phrase}`);
  }
});

test('does not treat a normal question as a continuation', () => {
  assert.strictEqual(isContinuationRequest('What are the best high-top sneakers?'), false);
  assert.strictEqual(isContinuationRequest('Write me a poem'), false);
});

test('query terms drop conversational filler', () => {
  const terms = queryTerms("let's continue our discussion about the shoes");
  assert.ok(terms.includes('shoes'), `expected "shoes" in ${JSON.stringify(terms)}`);
  assert.ok(!terms.includes('continue'), 'filler must be dropped');
  assert.ok(!terms.includes('discussion'), 'filler must be dropped');
});

// ---------------------------------------------------------------------------
section('findRelevantConversations — finds the right history');
// ---------------------------------------------------------------------------
const conversations = [
  {
    id: 'conv_shoes',
    title: 'Sneaker design',
    created_at: '2026-10-01T10:00:00.000Z',
    messages: [
      { role: 'user', content: 'I love obsidian black high-top sneakers with a gum sole.' },
      { role: 'assistant', content: 'The gum sole gives it a retro basketball feel.' },
    ],
  },
  {
    id: 'conv_taxes',
    title: 'Quarterly taxes',
    created_at: '2026-10-02T10:00:00.000Z',
    messages: [{ role: 'user', content: 'We decided to file in October.' }],
  },
];

test('a full sentence finds the matching conversation', () => {
  const hits = findRelevantConversations(conversations, "let's continue our discussion about the shoes");
  assert.ok(hits.length >= 1);
  assert.strictEqual(hits[0].conversationId, 'conv_shoes');
});

test('matches through inflection: "shoes" finds "shoe"', () => {
  const hits = findRelevantConversations(
    [{ id: 'c1', title: 'Footwear', messages: [{ role: 'user', content: 'That one shoe fits perfectly.' }] }],
    'shoes',
  );
  assert.strictEqual(hits.length, 1);
});

test('matches through a documented concept group, and says so', () => {
  const hits = findRelevantConversations(conversations, 'shoes');
  assert.strictEqual(hits[0]?.conversationId, 'conv_shoes');
  assert.ok(
    hits[0].reasons.some((reason) => /related term "sneaker"/.test(reason)),
    `expected the reason to name the substitution, got ${JSON.stringify(hits[0]?.reasons)}`,
  );
});

test('an exact match outranks a concept-equivalent match', () => {
  const ranked = findRelevantConversations(
    [
      { id: 'exact', title: 'Shoes', messages: [{ role: 'user', content: 'the shoes' }] },
      { id: 'synonym', title: 'Sneakers', messages: [{ role: 'user', content: 'the sneakers' }] },
    ],
    'shoes',
  );
  assert.strictEqual(ranked[0].conversationId, 'exact', 'exact wording must win');
});

test('a concept match does not leak across unrelated words', () => {
  const hits = findRelevantConversations(
    [{ id: 'c1', title: 'Cartoons', messages: [{ role: 'user', content: 'I love cartoons about cars.' }] }],
    'shoes',
  );
  assert.strictEqual(hits.length, 0, 'no false positive from unrelated vocabulary');
});

test('returns reasons, not just a bare score', () => {
  const hits = findRelevantConversations(conversations, 'sneakers gum sole');
  assert.ok(hits[0].reasons.length > 0);
});

test('excludes conversations with no evidence', () => {
  const hits = findRelevantConversations(conversations, 'hydroponic tomatoes');
  assert.strictEqual(hits.length, 0, 'no match must not return everything');
});

test('excludes the current conversation when asked', () => {
  const hits = findRelevantConversations(conversations, 'sneakers', { excludeId: 'conv_shoes' });
  assert.ok(hits.every((hit) => hit.conversationId !== 'conv_shoes'));
});

// ---------------------------------------------------------------------------
section('buildConversationContext — long threads keep their opening');
// ---------------------------------------------------------------------------
test('keeps the opening of a long conversation', () => {
  const messages = Array.from({ length: 100 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index} about topic ${index === 0 ? 'kangaroo leather' : 'misc'}`,
  }));
  const context = buildConversationContext(messages as any, 'what do you remember?');
  assert.ok(context.length > 0);
  assert.ok(
    context.some((entry) => entry.content.includes('kangaroo leather')),
    'the opening must be retained',
  );
  assert.ok(context.length <= 40, 'context stays bounded');
});

test('retrieves an old message that matches the current question', () => {
  const messages = [
    { role: 'user', content: 'The client prefers matte finishes.' },
    ...Array.from({ length: 60 }, (_, index) => ({ role: index % 2 ? 'user' : 'assistant', content: `filler ${index}` })),
  ];
  const context = buildConversationContext(messages as any, 'what does the client prefer?', { maxMessages: 8 });
  assert.ok(context.some((entry) => /matte finishes/i.test(entry.content)));
});

test('empty history yields empty context', () => {
  assert.deepStrictEqual(buildConversationContext([], 'hello'), []);
});

test('resume brief names the conversation and its topics', () => {
  const brief = buildResumeBrief(conversations[0] as any, [{ text: 'I love obsidian black high-top sneakers.' }]);
  assert.ok(brief.includes('Sneaker design'));
  assert.ok(brief.includes('Remembered details'));
});

// ---------------------------------------------------------------------------
section('TaskRegistry — durable, owner-scoped tasks');
// ---------------------------------------------------------------------------
test('creates a task in the queued state', () => {
  const { task } = taskRegistry.create([], 'owner_a', { capability: 'research', description: 'Research the market' });
  assert.strictEqual(task.status, 'queued');
  assert.strictEqual(task.ownerId, 'owner_a');
  assert.ok(task.progress.length >= 1);
});

test('a second owner cannot read the first owner\'s task', () => {
  const { next, task } = taskRegistry.create([], 'owner_a', { capability: 'research', description: 'secret' });
  assert.throws(() => taskRegistry.find(next, 'owner_b', task.id), /not found/i);
});

test('a second owner cannot cancel the first owner\'s task', () => {
  const { next, task } = taskRegistry.create([], 'owner_a', { capability: 'research', description: 'secret' });
  assert.throws(() => taskRegistry.requestCancel(next, 'owner_b', task.id), /not found/i);
});

test('rejects a cancelled task being restarted', () => {
  const created = taskRegistry.create([], 'owner_a', { capability: 'research', description: 'x' });
  const cancelled = taskRegistry.requestCancel(created.next, 'owner_a', created.task.id);
  assert.throws(
    () => taskRegistry.transition(cancelled.next, 'owner_a', created.task.id, 'running'),
    /cannot be restarted/i,
  );
});

test('rejects an empty description', () => {
  assert.throws(() => taskRegistry.create([], 'owner_a', { capability: 'research', description: '   ' }), /description is required/i);
});

test('records outputs and retries', () => {
  const created = taskRegistry.create([], 'owner_a', { capability: 'document', description: 'Make a report' });
  const withOutput = taskRegistry.addOutput(created.next, 'owner_a', created.task.id, { label: 'report.pdf', href: '/x/report.pdf' });
  assert.strictEqual(withOutput.task.outputs.length, 1);
  const withRetry = taskRegistry.recordRetry(withOutput.next, 'owner_a', created.task.id, 'network down');
  assert.strictEqual(withRetry.task.retries.length, 1);
  assert.ok(withRetry.task.progress.some((event) => event.phase === 'retry'));
});

test('summarise counts only the owner\'s tasks', () => {
  let tasks: RareTask[] = [];
  tasks = taskRegistry.create(tasks, 'owner_a', { capability: 'research', description: 'a' }).next;
  tasks = taskRegistry.create(tasks, 'owner_b', { capability: 'research', description: 'b' }).next;
  const summary = taskRegistry.summarise(tasks, 'owner_a');
  assert.strictEqual(summary.total, 1);
  assert.strictEqual(summary.queued, 1);
});

// ---------------------------------------------------------------------------
section('OwnerIdentity — configuration, not hardcoded source');
// ---------------------------------------------------------------------------
test('default owner address is the documented default', () => {
  const previous = process.env.RARE_OWNER_EMAIL;
  delete process.env.RARE_OWNER_EMAIL;
  assert.strictEqual(getOwnerEmail(), DEFAULT_OWNER_EMAIL);
  if (previous !== undefined) process.env.RARE_OWNER_EMAIL = previous;
});

test('RARE_OWNER_EMAIL overrides the default', () => {
  const previous = process.env.RARE_OWNER_EMAIL;
  process.env.RARE_OWNER_EMAIL = 'Owner@Example.COM';
  assert.strictEqual(getOwnerEmail(), 'owner@example.com');
  if (previous === undefined) delete process.env.RARE_OWNER_EMAIL;
  else process.env.RARE_OWNER_EMAIL = previous;
});

test('a malformed configured address falls back to the default', () => {
  const previous = process.env.RARE_OWNER_EMAIL;
  process.env.RARE_OWNER_EMAIL = 'not-an-email';
  assert.strictEqual(getOwnerEmail(), DEFAULT_OWNER_EMAIL);
  if (previous === undefined) delete process.env.RARE_OWNER_EMAIL;
  else process.env.RARE_OWNER_EMAIL = previous;
});

test('ownership is decided from the session account, not a body string', () => {
  const previous = process.env.RARE_OWNER_EMAIL;
  delete process.env.RARE_OWNER_EMAIL;
  assert.strictEqual(isOwnerAccount({ id: 'usr_owner_1', email: DEFAULT_OWNER_EMAIL }), true);
  assert.strictEqual(isOwnerAccount({ id: 'usr_x', email: 'someone@else.com' }), false);
  assert.strictEqual(isOwnerAccount(null), false);
  if (previous !== undefined) process.env.RARE_OWNER_EMAIL = previous;
});

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(60)}`);
console.log(`Stage 1 chat tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  throw new Error(`Stage 1 chat tests failed: ${failures.join(', ')}`);
}
}
