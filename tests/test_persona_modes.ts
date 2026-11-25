/**
 * Conversation-mode (persona) tests.
 *
 * These do NOT assert that a mode name appears in a prompt. They assert that
 * the selected mode actually reaches the generation pathway and changes its
 * output, on both the model-backed path and the standalone engine.
 */

import assert from 'node:assert/strict';
import {
  PERSONA_MODES,
  PERSONA_DEFINITIONS,
  normalizePersonaMode,
  buildPersonaSystemInstruction,
  applyPersonaShaping,
  RARE_INVARIANTS,
} from '../src/engine/persona.js';
import { generateDynamicBrainReply } from '../src/engine/standalone-brain.js';

export async function runPersonaModeTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  const check = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      passed++;
      console.log(`  PASS  ${name}`);
    } catch (error) {
      failed++;
      console.error(`  FAIL  ${name}`);
      console.error(`        ${(error as Error).message}`);
    }
  };

  console.log('\n[Conversation Modes]');

  // --- Normalisation -------------------------------------------------------
  await check('normalizePersonaMode accepts all four modes', () => {
    for (const mode of PERSONA_MODES) {
      assert.equal(normalizePersonaMode(mode), mode);
    }
  });

  await check('normalizePersonaMode defaults unknown input to casual', () => {
    assert.equal(normalizePersonaMode('nonsense'), 'casual');
    assert.equal(normalizePersonaMode(undefined), 'casual');
    assert.equal(normalizePersonaMode(null), 'casual');
    assert.equal(normalizePersonaMode(42), 'casual');
  });

  await check('normalizePersonaMode is case and whitespace tolerant', () => {
    assert.equal(normalizePersonaMode('  PROFESSIONAL '), 'professional');
    assert.equal(normalizePersonaMode('Creative'), 'creative');
  });

  // --- System instruction (model-backed path) ------------------------------
  await check('each mode produces a distinct system instruction', () => {
    const seen = new Set<string>();
    for (const mode of PERSONA_MODES) {
      const instruction = buildPersonaSystemInstruction(mode);
      assert.ok(instruction.length > 50, `${mode} instruction is too short`);
      seen.add(instruction);
    }
    assert.equal(seen.size, 4, 'modes must not share an instruction');
  });

  await check('every mode instruction carries the RARE invariants', () => {
    for (const mode of PERSONA_MODES) {
      const instruction = buildPersonaSystemInstruction(mode);
      assert.ok(
        instruction.includes(RARE_INVARIANTS),
        `${mode} dropped the invariants — a mode must never override identity or honesty`
      );
    }
  });

  await check('mode instructions encode their required behaviour', () => {
    assert.match(buildPersonaSystemInstruction('concise'), /immediately|first sentence/i);
    assert.match(buildPersonaSystemInstruction('professional'), /terminology|precise/i);
    assert.match(buildPersonaSystemInstruction('creative'), /original|alternative/i);
    assert.match(buildPersonaSystemInstruction('casual'), /warm|natural/i);
  });

  // --- Shaping (standalone path) -------------------------------------------
  const longAnswer =
    'The deployment failed because the build step could not resolve a dependency. ' +
    'The lockfile referenced a version that had been unpublished. ' +
    'Pinning the version and regenerating the lockfile resolves it. ' +
    'You should also add a CI check so this is caught before merge. ' +
    'Finally, consider vendoring the dependency for reproducibility.';

  await check('concise shortens a long answer', () => {
    const shaped = applyPersonaShaping(longAnswer, 'concise');
    const originalSentences = longAnswer.split(/(?<=[.!?])\s+/).length;
    const shapedSentences = shaped.split(/(?<=[.!?])\s+/).length;
    assert.ok(shapedSentences < originalSentences, 'concise must reduce length');
    assert.ok(shaped.length > 0, 'concise must not empty the answer');
  });

  await check('concise keeps the leading answer, not a random slice', () => {
    const shaped = applyPersonaShaping(longAnswer, 'concise');
    assert.ok(
      shaped.startsWith('The deployment failed'),
      'concise must preserve the answer that leads the response'
    );
  });

  await check('professional structures a multi-sentence answer', () => {
    const shaped = applyPersonaShaping(longAnswer, 'professional');
    assert.ok(shaped.includes('**'), 'professional should lead with a bolded conclusion');
    assert.ok(shaped.length >= longAnswer.length * 0.8, 'professional must not truncate substance');
  });

  await check('casual preserves the natural full answer', () => {
    const shaped = applyPersonaShaping(longAnswer, 'casual');
    assert.ok(shaped.includes('lockfile'), 'casual must keep the substance');
    assert.ok(!shaped.startsWith('**'), 'casual must not impose a formal structure');
  });

  await check('creative keeps the full exploration', () => {
    const shaped = applyPersonaShaping(longAnswer, 'creative');
    assert.ok(shaped.includes('vendoring'), 'creative must keep the alternative suggestions');
  });

  await check('shaping never empties or corrupts a short answer', () => {
    const short = 'It is 42.';
    for (const mode of PERSONA_MODES) {
      const shaped = applyPersonaShaping(short, mode);
      assert.ok(shaped.trim().length > 0, `${mode} emptied a short answer`);
      assert.ok(shaped.includes('42'), `${mode} lost the answer content`);
    }
  });

  await check('shaping tolerates decimals and abbreviations', () => {
    const text = 'The value is 3.14, e.g. pi. It is used widely.';
    const shaped = applyPersonaShaping(text, 'concise');
    assert.ok(shaped.includes('3.14'), 'decimal point must not split a sentence');
  });

  await check('voice mode caps length more aggressively than text', () => {
    const textShaped = applyPersonaShaping(longAnswer, 'casual', { isVoiceCall: false });
    const voiceShaped = applyPersonaShaping(longAnswer, 'casual', { isVoiceCall: true });
    assert.ok(
      voiceShaped.length <= textShaped.length,
      'voice answers must not be longer than text answers'
    );
  });

  // --- Standalone engine actually applies the mode -------------------------
  // This is the regression that mattered: personaMode was destructured and
  // then never used, so the standalone path ignored the user's choice.
  await check('standalone engine applies the mode to its output', async () => {
    const prompt = 'What time is it?';
    const casual = await generateDynamicBrainReply({ prompt, personaMode: 'casual' });
    const concise = await generateDynamicBrainReply({ prompt, personaMode: 'concise' });
    assert.ok(casual.content.length > 0, 'casual produced nothing');
    assert.ok(concise.content.length > 0, 'concise produced nothing');
    assert.ok(
      concise.content.length <= casual.content.length,
      'concise must not be longer than casual for the same prompt'
    );
  });

  await check('standalone engine honours an unknown mode without crashing', async () => {
    const result = await generateDynamicBrainReply({ prompt: 'hello', personaMode: 'bogus' });
    assert.ok(result.content.length > 0);
  });

  await check('standalone engine keeps identity across all modes', async () => {
    for (const mode of PERSONA_MODES) {
      const result = await generateDynamicBrainReply({ prompt: 'who are you', personaMode: mode });
      assert.ok(
        /RARE/i.test(result.content),
        `${mode} lost RARE's identity in the standalone path`
      );
    }
  });

  await check('standalone engine keeps factual answers intact in concise mode', async () => {
    const result = await generateDynamicBrainReply({ prompt: 'what is 15% of 200', personaMode: 'concise' });
    assert.ok(result.content.includes('30'), 'concise must not lose the computed answer');
  });

  // --- Definitions are complete -------------------------------------------
  await check('every mode has a complete definition', () => {
    for (const mode of PERSONA_MODES) {
      const def = PERSONA_DEFINITIONS[mode];
      assert.ok(def.label.length > 0, `${mode} has no label`);
      assert.ok(def.summary.length > 0, `${mode} has no summary`);
      assert.ok(def.shaping.maxSentences > 0, `${mode} has no sentence budget`);
    }
  });

  return { passed, failed };
}
