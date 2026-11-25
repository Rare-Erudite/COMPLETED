/**
 * Live verification: drive the REAL GeminiCoprocessorProvider through all four
 * conversation modes and capture the actual returned text.
 *
 * This is not a prompt-inspection test. It calls the provider's own generate()
 * with the same options the conversation API passes, and prints what the model
 * actually returned for each mode.
 */
import { GeminiCoprocessorProvider } from '../src/server/providers/GeminiCoprocessorProvider.js';
import { PERSONA_MODES } from '../src/engine/persona.js';

const PROMPT =
  'I need to add offline support to a React web app. How should I approach it?';

async function main() {
  const provider = new GeminiCoprocessorProvider();

  console.log('=== PROVIDER CONFIGURATION ===');
  console.log('isConfigured():', provider.isConfigured());
  const info = await provider.getInfo();
  console.log('provider info:', JSON.stringify(info, null, 1));

  const results: Record<string, { text: string; model: string; ms: number }> = {};

  for (const mode of PERSONA_MODES) {
    const started = Date.now();
    try {
      const res = await provider.generate(PROMPT, undefined, { persona: mode });
      const ms = Date.now() - started;
      results[mode] = { text: res.reply, model: res.modelUsed, ms };
      console.log(`\n\n########## MODE: ${mode} ##########`);
      console.log(`model=${res.modelUsed}  latency=${ms}ms  chars=${res.reply.length}`);
      console.log('--- ACTUAL RESPONSE ---');
      console.log(res.reply);
    } catch (err: any) {
      console.log(`\n\n########## MODE: ${mode} ##########`);
      console.log('FAILED:', err?.message || String(err));
      results[mode] = { text: '', model: 'ERROR', ms: Date.now() - started };
    }
  }

  console.log('\n\n=== SUMMARY ===');
  for (const mode of PERSONA_MODES) {
    const r = results[mode];
    const sentences = r.text ? r.text.split(/(?<=[.!?])\s+/).filter(Boolean).length : 0;
    console.log(
      `${mode.padEnd(13)} model=${r.model.padEnd(20)} chars=${String(r.text.length).padStart(5)} sentences=${String(sentences).padStart(3)} ms=${r.ms}`
    );
  }

  // Persist raw output for the report.
  const fs = await import('node:fs');
  fs.writeFileSync(
    'gemini_mode_results.json',
    JSON.stringify({ prompt: PROMPT, results }, null, 2)
  );
  console.log('\nRaw results written to gemini_mode_results.json');
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
