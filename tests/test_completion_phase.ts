/**
 * Tests for the completion phase: intent execution, blob storage, MCP
 * integration, plugin separation, resilience and observability.
 *
 * These are unit-level and run without a server. The end-to-end checks against
 * a live server live in test_intent_execution_e2e.ts.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  executeIntent,
  isConsequential,
  planDeviceAction,
  resolveAppPackage,
  inferScheduleExpression,
  type IntentExecutionDeps,
} from '../src/server/chat/IntentExecutor.js';
import { routeChatIntent } from '../src/server/chat/IntentRouter.js';
import { BlobStore } from '../src/server/storage/BlobStore.js';
import { withRetry, critiqueAnswer, recentFailures, clearFailures } from '../src/server/services/Resilience.js';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** A minimal in-memory owner-scoped store, matching the real interface. */
function memoryStore() {
  const data = new Map<string, unknown>();
  return {
    async getOwnedState<T>(ownerId: string, key: string, initial: T): Promise<T> {
      const composite = `${ownerId}:${key}`;
      if (!data.has(composite)) data.set(composite, initial);
      return data.get(composite) as T;
    },
    async updateOwnedState<T>(ownerId: string, key: string, initial: T, update: (current: T) => T): Promise<T> {
      const composite = `${ownerId}:${key}`;
      const current = (data.has(composite) ? data.get(composite) : initial) as T;
      const next = update(current);
      data.set(composite, next);
      return next;
    },
  };
}

export async function runCompletionPhaseTests(): Promise<{ passed: number; failed: number }> {
  console.log('=== Completion phase: intent execution, blobs, MCP, resilience ===');

  // ---------------------------------------------------------------- Device plan
  check('"open WhatsApp" resolves to the WhatsApp package',
    resolveAppPackage('Open WhatsApp.').packageName === 'com.whatsapp');
  check('"open google maps" prefers the longer name',
    resolveAppPackage('open google maps').packageName === 'com.google.android.apps.maps');
  check('"describe what is on my screen" plans describe_screen',
    planDeviceAction('Describe what is on my screen.')?.action === 'describe_screen');
  check('"scroll down" plans a scroll',
    planDeviceAction('Scroll down.')?.action === 'scroll');
  check('"check my notifications" plans notifications',
    planDeviceAction('Check my notifications.')?.action === 'notifications');
  check('an unplannable device request returns null',
    planDeviceAction('do the thing on my phone') === null);

  // ------------------------------------------------------------ Consequential
  check('sending a message is consequential',
    isConsequential('send a message to Alice').consequential);
  check('deleting is consequential', isConsequential('delete my files').consequential);
  check('opening an app is not consequential',
    !isConsequential('open WhatsApp').consequential);
  check('scrolling is not consequential', !isConsequential('scroll down').consequential);

  // -------------------------------------------------------------- Schedule parse
  check('"every morning" becomes 08:00',
    inferScheduleExpression('Remind me every morning') === 'every day at 08:00');
  check('"every 5 minutes" is preserved',
    inferScheduleExpression('check my notifications every 5 minutes') === 'every 5 minutes');
  check('"at 7:30 pm" becomes 19:30',
    inferScheduleExpression('remind me at 7:30 pm') === 'every day at 19:30');

  // ------------------------------------------------------- Intent execution
  const store = memoryStore();
  const created: any[] = [];
  const deps: IntentExecutionDeps = {
    deviceQueue: null,
    scheduler: {
      async list() { return created; },
      async create(_owner, input) {
        const task = { id: `sch_${created.length + 1}`, ...input, status: 'active' };
        created.push(task);
        return task;
      },
      async setEnabled(_owner, id, enabled) {
        const task = created.find((item) => item.id === id);
        if (!task) return false;
        task.status = enabled ? 'active' : 'paused';
        return true;
      },
      async remove(_owner, id) {
        const index = created.findIndex((item) => item.id === id);
        if (index < 0) return false;
        created.splice(index, 1);
        return true;
      },
      async runNow() { return {}; },
    },
    pluginRegistry: null,
    mcp: null,
  };

  // Device with no queue must say so, not pretend.
  const noDevice = await executeIntent(routeChatIntent('Open WhatsApp.'), 'Open WhatsApp.', 'u1', deps);
  check('a device request with no channel reports unavailable',
    noDevice?.status === 'unavailable' && /not initialised/i.test(noDevice.reply));

  // Schedule creation actually creates.
  const scheduleDecision = routeChatIntent('Remind me every morning.');
  check('"Remind me every morning" routes to schedule', scheduleDecision.intent === 'schedule');
  const scheduleResult = await executeIntent(scheduleDecision, 'Remind me every morning.', 'u1', deps);
  check('a schedule request creates a real task',
    scheduleResult?.status === 'executed' && created.length === 1);
  check('the created task carries the parsed schedule',
    created[0]?.schedule === 'every day at 08:00', JSON.stringify(created[0]));

  // Pause actually pauses.
  const pauseResult = await executeIntent(
    routeChatIntent('Pause my existing reminder.'),
    'Pause my existing reminder.',
    'u1',
    deps,
  );
  check('"Pause my existing reminder" pauses the task',
    pauseResult?.status === 'executed' && created[0]?.status === 'paused',
    JSON.stringify(pauseResult));

  // Plugin with nothing connected must not invent a tool.
  const pluginResult = await executeIntent(
    routeChatIntent('Use the connected plugin to perform this task.'),
    'Use the connected plugin to perform this task.',
    'u1',
    deps,
  );
  check('a plugin request with no server reports unavailable',
    pluginResult?.status === 'unavailable' && /no mcp plugin is connected/i.test(pluginResult.reply));

  // Consequential action is withheld.
  const risky = await executeIntent(
    routeChatIntent('Open WhatsApp and send a message to Alice'),
    'Open WhatsApp and send a message to Alice',
    'u1',
    deps,
  );
  check('a consequential request is withheld pending confirmation',
    risky?.status === 'awaiting_confirmation' && risky.needsConfirmation === true);

  // ------------------------------------------------------------- Blob store
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rare-blob-'));
  const blobDeps = {
    hasDatabase: () => false,
    async query() { throw new Error('no database in this test'); },
    ...store,
  };
  const blobs = new BlobStore(blobDeps as any, tmpRoot);

  // A 2 MB payload — well above the inline threshold.
  const large = Buffer.alloc(2 * 1024 * 1024);
  for (let i = 0; i < large.length; i++) large[i] = i % 251;

  const meta = await blobs.put('owner-a', large, { mimeType: 'image/png', filename: 'big.png' });
  check('a large blob is stored with its real size', meta.size === large.length);
  check('the blob records a sha256', /^[0-9a-f]{64}$/.test(meta.sha256));

  const readBack = await blobs.get('owner-a', meta.blobId);
  check('a large blob round-trips byte for byte',
    readBack !== null && Buffer.compare(readBack.buffer, large) === 0);

  const otherOwner = await blobs.get('owner-b', meta.blobId);
  check('another owner cannot read the blob', otherOwner === null);

  const usage = await blobs.usage('owner-a');
  check('usage reports the stored bytes', usage.bytes === large.length && usage.count === 1);

  const deleted = await blobs.delete('owner-a', meta.blobId);
  check('a blob can be deleted', deleted === true);
  check('a deleted blob is gone', (await blobs.get('owner-a', meta.blobId)) === null);

  fs.rmSync(tmpRoot, { recursive: true, force: true });

  // -------------------------------------------------------------- Resilience
  clearFailures();
  let attempts = 0;
  const retried = await withRetry(async () => {
    attempts++;
    if (attempts < 3) {
      const error: any = new Error('temporarily unavailable');
      error.status = 503;
      throw error;
    }
    return 'ok';
  }, { attempts: 3, baseDelayMs: 5 });
  check('a transient failure is retried and succeeds', retried === 'ok' && attempts === 3);

  let permanentAttempts = 0;
  let threw = false;
  try {
    await withRetry(async () => {
      permanentAttempts++;
      const error: any = new Error('bad request');
      error.status = 400;
      throw error;
    }, { attempts: 3, baseDelayMs: 5 });
  } catch {
    threw = true;
  }
  check('a permanent failure is not retried', threw && permanentAttempts === 1);
  check('the failure is recorded for inspection', recentFailures().length >= 1);

  // ------------------------------------------------------------- Self-critique
  check('an empty answer is flagged', critiqueAnswer('').length > 0);
  check('a refusal is flagged', critiqueAnswer("I can't do that.").length > 0);
  check('a sourced answer passes',
    critiqueAnswer('The report found three causes, each documented.', { expectsSources: true, sourceCount: 3 }).length === 0);
  check('a missing-source claim is flagged',
    critiqueAnswer('The report found three causes.', { expectsSources: true, sourceCount: 0 }).length > 0);

  console.log(`  -- completion phase: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
