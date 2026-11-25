/**
 * Regression: the selected conversation mode must survive the hop from the
 * conversation API through ProviderRegistry into the provider that actually
 * generates the reply.
 *
 * The earlier defect was that `persona` was accepted at the API boundary and
 * then dropped before generation. A test that only checks the prompt text
 * would not catch that, so this one asserts on what the provider RECEIVES.
 */
import assert from 'node:assert/strict';
import { ProviderRegistry } from '../src/server/providers/ProviderRegistry.js';
import { buildPersonaSystemInstruction, PERSONA_MODES } from '../src/engine/persona.js';

export async function runPersonaPropagationTests() {
  console.log('\n--- Persona propagation through ProviderRegistry ---');

  // 1. Every mode produces a distinct system instruction.
  const instructions = PERSONA_MODES.map((m) => buildPersonaSystemInstruction(m));
  assert.equal(new Set(instructions).size, PERSONA_MODES.length,
    'each mode must produce a distinct system instruction');
  console.log(`  ok: ${PERSONA_MODES.length} modes produce ${new Set(instructions).size} distinct instructions`);

  // 2. Invariants are present in every mode.
  for (const m of PERSONA_MODES) {
    const text = buildPersonaSystemInstruction(m);
    assert.ok(text.includes('you remain RARE'), `mode ${m} must carry RARE invariants`);
    assert.ok(text.includes('Never invent facts'), `mode ${m} must carry the honesty invariant`);
  }
  console.log('  ok: RARE invariants present in all four modes');

  // 3. Unknown / missing mode falls back safely rather than throwing.
  assert.ok(buildPersonaSystemInstruction(undefined).length > 0);
  assert.ok(buildPersonaSystemInstruction('nonsense').length > 0);
  assert.equal(buildPersonaSystemInstruction('nonsense'), buildPersonaSystemInstruction('casual'));
  console.log('  ok: unknown mode falls back to casual');

  // 4. The registry must forward `persona` to the provider it selects.
  //    We stub the provider so we can observe exactly what it receives.
  const registry = new ProviderRegistry();
  const gemini = registry.getGeminiProvider();

  const seen: Array<string | undefined> = [];
  const originalGenerate = gemini.generate.bind(gemini);
  (gemini as any).generate = async (prompt: string, context: string, options: any) => {
    seen.push(options?.persona);
    return { reply: `stub:${options?.persona}`, modelUsed: 'stub', providerType: 'gemini_coprocessor' };
  };
  (gemini as any).isAvailable = async () => true;

  try {
    for (const mode of PERSONA_MODES) {
      const result = await registry.generateOnline('test prompt', 'ctx', { persona: mode } as any);
      assert.equal(result.reply, `stub:${mode}`,
        `registry must forward persona=${mode} to the provider`);
    }
  } finally {
    (gemini as any).generate = originalGenerate;
  }

  assert.deepEqual(seen, PERSONA_MODES,
    'provider must receive every mode in order, none dropped');
  console.log(`  ok: registry forwarded all ${seen.length} modes to the provider: ${seen.join(', ')}`);

  console.log('  PASS: persona propagation');
}
