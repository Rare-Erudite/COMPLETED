/**
 * Device action catalogue + planner validation tests.
 *
 * These assert the security boundary of the device agent: a model may only
 * propose actions that exist in the canonical catalogue, with arguments that
 * match the declared schema. Anything else is rejected before it can reach a
 * phone. No device is required — this is pure validation logic.
 */

import assert from 'node:assert/strict';
import {
  DEVICE_ACTIONS,
  getDeviceAction,
  validateDeviceAction,
  describeDeviceActionsForModel,
} from '../src/device/deviceActions.js';

export async function runDeviceActionTests(): Promise<void> {
  console.log('[Test Group] Device action catalogue & planner validation');

  // The catalogue is non-empty and every entry is well-formed.
  assert.ok(DEVICE_ACTIONS.length >= 10, 'The device catalogue should expose the full action set.');
  for (const action of DEVICE_ACTIONS) {
    assert.equal(typeof action.name, 'string');
    assert.equal(typeof action.description, 'string');
    assert.ok(Array.isArray(action.params));
    assert.equal(typeof action.mutating, 'boolean');
    assert.equal(typeof action.sensitive, 'boolean');
  }
  console.log(`  ✓ ${DEVICE_ACTIONS.length} actions declared`);

  // A known action resolves; an unknown one does not.
  assert.ok(getDeviceAction('tap_text'));
  assert.equal(getDeviceAction('rm_rf'), undefined);
  console.log('  ✓ known actions resolve, unknown actions do not');

  // A valid action passes validation and its numeric args are coerced.
  const valid = validateDeviceAction({ tool: 'tap_at', args: { x: '100', y: 200 } });
  assert.equal(valid.valid, true);
  assert.equal(valid.action?.tool, 'tap_at');
  assert.equal(valid.action?.args.x, 100);
  assert.equal(valid.action?.args.y, 200);
  console.log('  ✓ valid action accepted and numeric args coerced');

  // An unknown tool is rejected.
  const unknown = validateDeviceAction({ tool: 'format_disk', args: {} });
  assert.equal(unknown.valid, false);
  assert.match(unknown.error || '', /Unknown device action/);
  console.log('  ✓ unknown tool rejected');

  // A missing required argument is rejected.
  const missing = validateDeviceAction({ tool: 'tap_text', args: {} });
  assert.equal(missing.valid, false);
  assert.match(missing.error || '', /requires the "text" argument/);
  console.log('  ✓ missing required argument rejected');

  // An out-of-enum value is rejected.
  const badEnum = validateDeviceAction({ tool: 'scroll', args: { direction: 'sideways' } });
  assert.equal(badEnum.valid, false);
  assert.match(badEnum.error || '', /must be one of/);
  console.log('  ✓ out-of-enum argument rejected');

  // A non-numeric value for a numeric argument is rejected.
  const badNumber = validateDeviceAction({ tool: 'tap_at', args: { x: 'left', y: 10 } });
  assert.equal(badNumber.valid, false);
  assert.match(badNumber.error || '', /must be a number/);
  console.log('  ✓ non-numeric argument rejected');

  // The model-facing description lists every action.
  const description = describeDeviceActionsForModel();
  for (const action of DEVICE_ACTIONS) {
    assert.ok(description.includes(action.name), `Description should mention ${action.name}`);
  }
  console.log('  ✓ model-facing description covers every action');

  console.log('  All device action tests passed.');
}
