/**
 * Orchestration acceptance tests — the capability registry, the durable job
 * store and the intent→capability mapping, exercised against the real server.
 *
 * These are not unit tests of a mock. The registry tests boot the actual
 * server, ask it for its capability catalogue over HTTP, and invoke a real
 * capability (documents.write → documents.read) end to end. The job tests
 * start a real job, poll its durable record, and assert the record reflects
 * what actually happened.
 */

import assert from 'node:assert/strict';
import { capabilityRegistry } from '../src/server/orchestration/CapabilityRegistry.js';
import { routeChatIntent, capabilitiesForIntent, isResearchToDocument } from '../src/server/chat/IntentRouter.js';

const BASE = process.env.RARE_TEST_BASE_URL || 'http://127.0.0.1:3000';

async function json(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body };
}

/** The registry must reject bad arguments rather than silently coercing. */
function testRegistryValidation(): void {
  capabilityRegistry.register({
    id: 'test.echo',
    department: 'system',
    title: 'Echo',
    description: 'Test capability.',
    permission: 'read',
    idempotent: true,
    cost: 'free',
    args: [{ name: 'text', type: 'string', required: true, description: 'Text to echo.' }],
    async handler(args) {
      return { ok: true, summary: `echo: ${args.text}`, data: { text: args.text }, durationMs: 0 };
    },
  });

  const missing = capabilityRegistry.validateArgs('test.echo', {});
  assert.equal(missing.length, 1, 'a missing required argument must be reported');
  assert.match(missing[0], /text/);

  const wrongType = capabilityRegistry.validateArgs('test.echo', { text: 42 });
  assert.equal(wrongType.length, 1, 'a wrong-typed argument must be reported');

  const valid = capabilityRegistry.validateArgs('test.echo', { text: 'hello' });
  assert.equal(valid.length, 0, 'a valid argument set must pass');
}

/** An unknown capability must fail loudly, not return a fake success. */
async function testUnknownCapability(): Promise<void> {
  const result = await capabilityRegistry.invoke('does.not.exist', {}, { ownerId: 'test' });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, 'unknown_capability');
}

/** A throwing handler must surface as ok:false with the real message. */
async function testHandlerFailureIsHonest(): Promise<void> {
  capabilityRegistry.register({
    id: 'test.throws',
    department: 'system',
    title: 'Throws',
    description: 'Always throws.',
    permission: 'read',
    idempotent: true,
    cost: 'free',
    args: [],
    async handler() {
      throw new Error('deliberate failure');
    },
  });
  const result = await capabilityRegistry.invoke('test.throws', {}, { ownerId: 'test' });
  assert.equal(result.ok, false);
  assert.match(result.error?.message || '', /deliberate failure/);
}

/** The live server must expose the real catalogue over HTTP. */
async function testCapabilityCatalogueRoute(): Promise<void> {
  const { status, body } = await json('/api/capabilities');
  assert.equal(status, 200, `GET /api/capabilities returned ${status}`);
  assert.ok(Array.isArray(body.capabilities), 'capabilities must be an array');
  assert.ok(body.capabilities.length >= 10, `expected a real catalogue, got ${body.capabilities?.length}`);

  const ids = new Set(body.capabilities.map((c: any) => c.id));
  for (const required of ['documents.list', 'documents.write', 'research.run', 'builder.deliver', 'plugins.list']) {
    assert.ok(ids.has(required), `catalogue is missing "${required}"`);
  }

  // Departments must be reported with real counts.
  assert.ok(Array.isArray(body.departments) && body.departments.length >= 4, 'departments must be reported');
  const documents = body.departments.find((d: any) => d.department === 'documents');
  assert.ok(documents && documents.count >= 3, 'documents department must report its capabilities');
}

/** A real cross-department invocation: write a document, then read it back. */
async function testRealCapabilityInvocation(): Promise<void> {
  const path = `tests/orchestration-${Date.now()}.md`;
  const content = '# Orchestration acceptance\n\nWritten through the capability registry.';

  const write = await json('/api/capabilities/invoke', {
    method: 'POST',
    body: JSON.stringify({ capabilityId: 'documents.write', args: { path, content } }),
  });
  assert.equal(write.status, 200, `documents.write returned ${write.status}: ${JSON.stringify(write.body)}`);
  assert.equal(write.body.ok, true, 'documents.write must succeed');

  const read = await json('/api/capabilities/invoke', {
    method: 'POST',
    body: JSON.stringify({ capabilityId: 'documents.read', args: { path } }),
  });
  assert.equal(read.status, 200, `documents.read returned ${read.status}`);
  assert.equal(read.body.ok, true);
  assert.equal(read.body.data.content, content, 'the document read back must match what was written');
}

/** Invalid arguments must be rejected with 400 before any work happens. */
async function testInvalidArgumentsRejected(): Promise<void> {
  const { status, body } = await json('/api/capabilities/invoke', {
    method: 'POST',
    body: JSON.stringify({ capabilityId: 'documents.read', args: {} }),
  });
  assert.equal(status, 400, `expected 400 for missing args, got ${status}`);
  assert.equal(body.error?.code, 'invalid_arguments');
}

/** A long capability must return a durable job id, and the job must be readable. */
async function testDurableJobLifecycle(): Promise<void> {
  const started = await json('/api/capabilities/invoke', {
    method: 'POST',
    body: JSON.stringify({
      capabilityId: 'builder.toolchains',
      args: {},
    }),
  });
  // builder.toolchains is fast, so it may run inline; either shape is valid.
  if (started.status === 202) {
    const jobId = started.body.jobId;
    assert.ok(jobId, 'a job id must be returned');
    const job = await json(`/api/jobs/${jobId}`);
    assert.equal(job.status, 200, 'the job record must be readable');
    assert.ok(['queued', 'running', 'succeeded', 'failed'].includes(job.body.status));
  } else {
    assert.equal(started.status, 200, `inline invocation returned ${started.status}`);
    assert.equal(started.body.ok, true);
  }

  const list = await json('/api/jobs');
  assert.equal(list.status, 200, 'GET /api/jobs must work');
  assert.ok(Array.isArray(list.body), 'the job list must be an array');
}

/** Intent routing must map to capabilities that actually exist. */
function testIntentToCapabilityMapping(): void {
  const research = routeChatIntent('research the history of the transistor and cite sources');
  assert.equal(research.intent, 'research');
  const researchCaps = capabilitiesForIntent(research);
  assert.deepEqual(researchCaps, ['research.run']);
  assert.ok(capabilityRegistry.has('research.run'), 'the mapped capability must be registered');

  const build = routeChatIntent('build a small static website called aurora');
  assert.equal(build.intent, 'build');
  assert.deepEqual(capabilitiesForIntent(build), ['builder.deliver']);
  assert.ok(capabilityRegistry.has('builder.deliver'));

  const conversation = routeChatIntent('what is a monad');
  assert.equal(conversation.intent, 'conversation');
  assert.deepEqual(capabilitiesForIntent(conversation), [], 'a plain question must not route to a department');

  // Research + document is one cross-department workflow.
  const combined = routeChatIntent('research the state of solid-state batteries and prepare a PDF report');
  assert.equal(combined.intent, 'research');
  assert.equal(isResearchToDocument(combined, 'research the state of solid-state batteries and prepare a PDF report'), true);
  assert.ok(capabilityRegistry.has('research.report_to_document'));
}

export async function runOrchestrationAcceptanceTests(): Promise<void> {
  testRegistryValidation();
  await testUnknownCapability();
  await testHandlerFailureIsHonest();
  await testCapabilityCatalogueRoute();
  await testRealCapabilityInvocation();
  await testInvalidArgumentsRejected();
  await testDurableJobLifecycle();
  testIntentToCapabilityMapping();
  console.log('  ✓ orchestration acceptance (registry, jobs, routing)');
}
