import assert from 'assert';
import { MemoryStore } from '../src/server/storage/MemoryStore.js';

export async function runMemoryTests() {
  console.log('--- Testing Memory Persistence & Lifecycle ---');

  const store = new MemoryStore();
  const initialCount = store.getAll().length;
  assert.ok(initialCount >= 4, 'Should initialize with verified seed memories');

  // 1. Store durable fact
  const token = `durable_fact_${Date.now()}`;
  const record = store.store({
    kind: 'preference',
    text: `User prefers dark mode and high-contrast charts. Token: ${token}`,
    tags: ['preferences', 'ui', 'contrast'],
    importance: 4,
    source: 'user_stated',
  });
  assert.ok(record.id, 'Record must have an ID');

  // 2. Search exact fact
  const hits = store.search(token);
  assert.strictEqual(hits.length, 1, 'Should find exactly one matching fact');
  assert.strictEqual(hits[0].id, record.id);

  // 3. Update memory
  const updated = store.update(record.id, {
    text: `User prefers dark mode and high-contrast charts with cobalt accents. Token: ${token}`,
    importance: 5,
  });
  assert.ok(updated, 'Update should succeed');
  assert.strictEqual(updated?.importance, 5);

  // 4. Persistence across instance reload
  const reloadedStore = new MemoryStore();
  const reloadedHits = reloadedStore.search(token);
  assert.strictEqual(reloadedHits.length, 1, 'Memory must persist across store re-instantiation');
  assert.ok(reloadedHits[0].text.includes('cobalt accents'));

  // 5. Delete memory
  const deleted = store.delete(record.id);
  assert.strictEqual(deleted, true, 'Delete should return true');
  assert.strictEqual(store.getById(record.id), undefined, 'Deleted record should no longer exist');

  // 6. Export memories
  const exp = store.export();
  assert.ok(exp.total > 0, 'Export total should be greater than zero');
  assert.ok(Array.isArray(exp.memories), 'Export memories should be an array');

  console.log('✓ Memory persistence and lifecycle tests passed.');
}
